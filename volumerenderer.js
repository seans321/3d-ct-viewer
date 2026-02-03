class VolumeRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }
        
        // Check for WebGL2 or OES_texture_float extension
        if (!this.gl.getExtension('OES_texture_float') && !this.gl.getExtension('OES_texture_half_float')) {
            console.warn('Floating point textures not supported, performance may be affected');
        }
        
        // For WebGL1, we need additional extensions for 3D textures simulation
        this.textureHalfFloat = this.gl.getExtension('OES_texture_half_float');
        this.textureHalfFloatLinear = this.gl.getExtension('OES_texture_half_float_linear');
        
        this.init();
    }
    
    init() {
        this.setupShaders();
        this.setupBuffers();
        this.setupTextures();
        this.setupUniforms();
        
        // Initialize camera
        this.cameraPosition = [0, 0, 5];
        this.cameraRotation = [0, 0];
        this.cameraTarget = [0, 0, 0];
        
        // Initialize volume properties
        this.threshold = 100;
        this.opacity = 0.8;
        this.volumeData = null;
        this.volumeTexture = null;
        
        // Mouse interaction
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        this.setupMouseHandlers();
    }
    
    setupShaders() {
        // Vertex shader for full-screen quad
        const vertexShaderSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                // Convert position to texture coordinates
                v_texCoord = (a_position + 1.0) / 2.0;
            }
        `;
        
        // Fragment shader for ray marching volume rendering
        // Using 2D texture to simulate 3D volume rendering
        // Fixed loop to use constant expression
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec2 v_texCoord;
            uniform sampler2D u_volumeTexture;
            uniform float u_textureWidth;
            uniform float u_textureHeight;
            uniform float u_slices;
            uniform float u_threshold;
            uniform float u_opacity;
            uniform vec3 u_viewDir;
            uniform vec3 u_lightPos;
            uniform vec3 u_cameraPos;
            uniform vec3 u_volumeSize;
            
            // Function to sample volume texture at 3D position
            float sampleVolume(vec3 pos) {
                // Normalize position to [0, 1] range
                pos = clamp(pos, 0.001, 0.999);
                
                // Calculate slice index and interpolation factor
                float sliceF = pos.z * u_slices;
                float sliceIdx = floor(sliceF);
                float sliceFrac = fract(sliceF);
                
                // Calculate UV coordinates for current slice
                vec2 uv = pos.xy;
                
                // Calculate texture coordinates accounting for slice layout
                float slicesPerRow = u_textureWidth / u_volumeSize.x;
                float row = floor(sliceIdx / slicesPerRow);
                float col = mod(sliceIdx, slicesPerRow);
                
                vec2 sliceSize = vec2(u_volumeSize.x / u_textureWidth, u_volumeSize.y / u_textureHeight);
                vec2 sliceOffset = vec2(col * u_volumeSize.x / u_textureWidth, row * u_volumeSize.y / u_textureHeight);
                
                uv = uv * sliceSize + sliceOffset;
                
                float value1 = texture2D(u_volumeTexture, uv).r;
                
                // Linear interpolation between slices if needed
                if (sliceFrac > 0.0 && sliceIdx < u_slices - 1.0) {
                    // Calculate coordinates for next slice
                    float nextSliceIdx = sliceIdx + 1.0;
                    float nextRow = floor(nextSliceIdx / slicesPerRow);
                    float nextCol = mod(nextSliceIdx, slicesPerRow);
                    
                    vec2 nextSliceOffset = vec2(nextCol * u_volumeSize.x / u_textureWidth, nextRow * u_volumeSize.y / u_textureHeight);
                    vec2 nextUv = uv - sliceOffset + nextSliceOffset;
                    
                    float value2 = texture2D(u_volumeTexture, nextUv).r;
                    return mix(value1, value2, sliceFrac);
                }
                
                return value1;
            }
            
            void main() {
                // Ray marching parameters
                vec3 rayStart = vec3(v_texCoord, 0.0);
                vec3 rayEnd = vec3(v_texCoord, 1.0);
                vec3 rayDir = normalize(rayEnd - rayStart);
                
                // Simple ray marching
                vec4 colorAccum = vec4(0.0);
                float stepSize = 0.01;
                
                // Fixed loop to use constant expression - WebGL requires constant in loops
                for (int i = 0; i < 200; i++) {
                    vec3 currentPos = rayStart + rayDir * float(i) * stepSize;
                    
                    // Check bounds
                    if (currentPos.x < 0.0 || currentPos.x > 1.0 ||
                        currentPos.y < 0.0 || currentPos.y > 1.0 ||
                        currentPos.z < 0.0 || currentPos.z > 1.0) {
                        break;
                    }
                    
                    // Sample the volume
                    float density = sampleVolume(currentPos);
                    
                    if (density > u_threshold / 255.0) {
                        // Calculate basic lighting
                        float intensity = (density - u_threshold / 255.0) / (1.0 - u_threshold / 255.0);
                        
                        // Simple lighting calculation
                        vec3 lightDir = normalize(u_lightPos - currentPos);
                        float diff = max(dot(normalize(rayDir), lightDir), 0.0);
                        float lighting = 0.2 + 0.8 * diff; // Ambient + Diffuse
                        
                        vec4 voxelColor = vec4(vec3(intensity * lighting), intensity * u_opacity);
                        
                        // Alpha compositing (front-to-back)
                        voxelColor.a *= intensity;
                        colorAccum = colorAccum + (1.0 - colorAccum.a) * voxelColor;
                        
                        // Early ray termination
                        if (colorAccum.a > 0.95) break;
                    }
                }
                
                gl_FragColor = clamp(colorAccum, 0.0, 1.0);
            }
        `;
        
        this.vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        this.fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        if (this.vertexShader && this.fragmentShader) {
            this.program = this.createProgram(this.vertexShader, this.fragmentShader);
        }
    }
    
    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
            console.log('Shader source:', source);
            this.gl.deleteShader(shader);
            return null;
        }
        
        return shader;
    }
    
    createProgram(vertexShader, fragmentShader) {
        const program = this.gl.createProgram();
        this.gl.attachShader(program, vertexShader);
        this.gl.attachShader(program, fragmentShader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Program linking error:', this.gl.getProgramInfoLog(program));
            this.gl.deleteProgram(program);
            return null;
        }
        
        return program;
    }
    
    setupBuffers() {
        // Full screen quad vertices
        this.quadVertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1
        ]);
        
        this.quadBuffer = this.gl.createBuffer();
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        this.gl.bufferData(this.gl.ARRAY_BUFFER, this.quadVertices, this.gl.STATIC_DRAW);
    }
    
    setupTextures() {
        // Create 2D texture to simulate 3D volume
        this.volumeTexture = this.gl.createTexture();
    }
    
    setupUniforms() {
        // Get uniform locations
        this.gl.useProgram(this.program);
        this.uniformLocations = {
            volumeTexture: this.gl.getUniformLocation(this.program, 'u_volumeTexture'),
            textureWidth: this.gl.getUniformLocation(this.program, 'u_textureWidth'),
            textureHeight: this.gl.getUniformLocation(this.program, 'u_textureHeight'),
            slices: this.gl.getUniformLocation(this.program, 'u_slices'),
            threshold: this.gl.getUniformLocation(this.program, 'u_threshold'),
            opacity: this.gl.getUniformLocation(this.program, 'u_opacity'),
            viewDir: this.gl.getUniformLocation(this.program, 'u_viewDir'),
            lightPos: this.gl.getUniformLocation(this.program, 'u_lightPos'),
            cameraPos: this.gl.getUniformLocation(this.program, 'u_cameraPos'),
            volumeSize: this.gl.getUniformLocation(this.program, 'u_volumeSize')
        };
    }
    
    setupMouseHandlers() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });
        
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                const deltaX = e.clientX - this.lastMouseX;
                const deltaY = e.clientY - this.lastMouseY;
                
                // Update rotation based on mouse movement
                this.cameraRotation[0] -= deltaY * 0.01;
                this.cameraRotation[1] -= deltaX * 0.01;
                
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
            }
        });
        
        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
        });
        
        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
        });
        
        // Zoom with scroll wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
            // Limit zoom range
            const distance = Math.max(2, Math.min(15, this.distanceFromTarget() * zoomFactor));
            this.setCameraDistance(distance);
        });
    }
    
    distanceFromTarget() {
        const dx = this.cameraPosition[0] - this.cameraTarget[0];
        const dy = this.cameraPosition[1] - this.cameraTarget[1];
        const dz = this.cameraPosition[2] - this.cameraTarget[2];
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    setCameraDistance(distance) {
        // Maintain direction, adjust distance
        const dir = [
            this.cameraPosition[0] - this.cameraTarget[0],
            this.cameraPosition[1] - this.cameraTarget[1],
            this.cameraPosition[2] - this.cameraTarget[2]
        ];
        
        const len = Math.sqrt(dir[0]*dir[0] + dir[1]*dir[1] + dir[2]*dir[2]);
        
        this.cameraPosition[0] = this.cameraTarget[0] + (dir[0]/len) * distance;
        this.cameraPosition[1] = this.cameraTarget[1] + (dir[1]/len) * distance;
        this.cameraPosition[2] = this.cameraTarget[2] + (dir[2]/len) * distance;
    }
    
    loadVolume(volumeData) {
        this.volumeData = volumeData;
        
        // Convert 3D volume data to 2D texture format
        const [width, height, depth] = volumeData.dimensions;
        
        // Calculate optimal 2D texture layout for the 3D volume
        // We'll arrange the depth slices in a 2D grid
        const slicesPerRow = Math.ceil(Math.sqrt(depth));
        const rows = Math.ceil(depth / slicesPerRow);
        
        const texWidth = slicesPerRow * width;
        const texHeight = rows * height;
        
        // Create a new array for the 2D texture
        // Use Uint8Array for UNSIGNED_BYTE format instead of Float32Array
        const textureData = new Uint8Array(texWidth * texHeight);
        
        // Fill the texture data by arranging depth slices in a 2D grid
        for (let z = 0; z < depth; z++) {
            const sliceRow = Math.floor(z / slicesPerRow);
            const sliceCol = z % slicesPerRow;
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const volumeIdx = z * width * height + y * width + x;
                    const texX = sliceCol * width + x;
                    const texY = sliceRow * height + y;
                    const texIdx = texY * texWidth + texX;
                    
                    // Convert to 0-255 range for Uint8Array
                    textureData[texIdx] = Math.max(0, Math.min(255, Math.round(volumeData.data[volumeIdx])));
                }
            }
        }
        
        // Ensure we have a valid texture
        if (!this.volumeTexture) {
            this.volumeTexture = this.gl.createTexture();
        }
        
        // Upload volume data to 2D texture - bind texture before setting parameters
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
        
        // Set texture parameters
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        // Determine the correct internal format and type based on WebGL capabilities
        let internalFormat = this.gl.LUMINANCE;
        let format = this.gl.LUMINANCE;
        let dataType = this.gl.UNSIGNED_BYTE;
        
        if (this.gl.getExtension('OES_texture_float')) {
            internalFormat = this.gl.LUMINANCE;
            format = this.gl.LUMINANCE;
            dataType = this.gl.FLOAT;
            // If we're using float extension, convert data to Float32Array
            if(dataType === this.gl.FLOAT) {
                // Create a Float32Array copy for floating point texture
                const floatTextureData = new Float32Array(textureData.length);
                for(let i = 0; i < textureData.length; i++) {
                    floatTextureData[i] = textureData[i] / 255.0; // Normalize to [0,1]
                }
                // Upload texture data using float array
                this.gl.texImage2D(
                    this.gl.TEXTURE_2D,         // target
                    0,                          // level
                    internalFormat,             // internalformat
                    texWidth,                   // width
                    texHeight,                  // height
                    0,                          // border
                    format,                     // format
                    dataType,                   // type
                    floatTextureData            // data
                );
            } else {
                // Upload texture data using byte array
                this.gl.texImage2D(
                    this.gl.TEXTURE_2D,         // target
                    0,                          // level
                    internalFormat,             // internalformat
                    texWidth,                   // width
                    texHeight,                  // height
                    0,                          // border
                    format,                     // format
                    dataType,                   // type
                    textureData                 // data
                );
            }
        } else if (this.gl.getExtension('OES_texture_half_float')) {
            internalFormat = this.gl.LUMINANCE;
            format = this.gl.LUMINANCE;
            dataType = this.gl.getExtension('OES_texture_half_float').HALF_FLOAT_OES;
            // If we're using half float extension, convert data appropriately
            if(dataType === this.gl.getExtension('OES_texture_half_float').HALF_FLOAT_OES) {
                // Create a Float32Array for half-float texture
                const floatTextureData = new Float32Array(textureData.length);
                for(let i = 0; i < textureData.length; i++) {
                    floatTextureData[i] = textureData[i] / 255.0; // Normalize to [0,1]
                }
                // Upload texture data using float array for half-float
                this.gl.texImage2D(
                    this.gl.TEXTURE_2D,         // target
                    0,                          // level
                    internalFormat,             // internalformat
                    texWidth,                   // width
                    texHeight,                  // height
                    0,                          // border
                    format,                     // format
                    dataType,                   // type
                    floatTextureData            // data
                );
            } else {
                // Fallback to byte array
                this.gl.texImage2D(
                    this.gl.TEXTURE_2D,         // target
                    0,                          // level
                    internalFormat,             // internalformat
                    texWidth,                   // width
                    texHeight,                  // height
                    0,                          // border
                    format,                     // format
                    dataType,                   // type
                    textureData                 // data
                );
            }
        } else {
            // Default case: use UNSIGNED_BYTE with Uint8Array
            this.gl.texImage2D(
                this.gl.TEXTURE_2D,         // target
                0,                          // level
                internalFormat,             // internalformat
                texWidth,                   // width
                texHeight,                  // height
                0,                          // border
                format,                     // format
                dataType,                   // type
                textureData                 // data
            );
        }
        
        // Unbind texture after uploading
        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        
        this.volumeDimensions = volumeData.dimensions;
        
        // Store texture layout info
        this.textureLayout = {
            width: texWidth,
            height: texHeight,
            slices: depth,
            volumeSize: [width, height, depth]
        };
    }
    
    setThreshold(value) {
        this.threshold = value;
    }
    
    setOpacity(value) {
        this.opacity = value;
    }
    
    resetCamera() {
        this.cameraPosition = [0, 0, 5];
        this.cameraRotation = [0, 0];
        this.cameraTarget = [0, 0, 0];
    }
    
    render() {
        if (!this.volumeData || !this.program) return;
        
        // Set viewport
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        
        // Clear canvas
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
        // Use shader program
        this.gl.useProgram(this.program);
        
        // Bind vertex buffer
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        
        // Get attribute location and enable it
        const positionAttributeLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(positionAttributeLocation);
        this.gl.vertexAttribPointer(positionAttributeLocation, 2, this.gl.FLOAT, false, 0, 0);
        
        // Set uniforms
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
        this.gl.uniform1i(this.uniformLocations.volumeTexture, 0);
        
        // Set texture layout uniforms
        if (this.textureLayout) {
            this.gl.uniform1f(this.uniformLocations.textureWidth, this.textureLayout.width);
            this.gl.uniform1f(this.uniformLocations.textureHeight, this.textureLayout.height);
            this.gl.uniform1f(this.uniformLocations.slices, this.textureLayout.slices);
            this.gl.uniform3f(this.uniformLocations.volumeSize, 
                             this.textureLayout.volumeSize[0],
                             this.textureLayout.volumeSize[1],
                             this.textureLayout.volumeSize[2]);
        }
        
        this.gl.uniform1f(this.uniformLocations.threshold, this.threshold);
        this.gl.uniform1f(this.uniformLocations.opacity, this.opacity);
        
        // Calculate view direction based on rotation
        const rotX = this.cameraRotation[0];
        const rotY = this.cameraRotation[1];
        
        // Simple camera orientation
        const viewDir = [
            Math.sin(rotY) * Math.cos(rotX),
            Math.sin(rotX),
            Math.cos(rotY) * Math.cos(rotX)
        ];
        
        this.gl.uniform3f(this.uniformLocations.viewDir, viewDir[0], viewDir[1], viewDir[2]);
        this.gl.uniform3f(this.uniformLocations.lightPos, 2.0, 2.0, 2.0);
        this.gl.uniform3f(this.uniformLocations.cameraPos, 
                         this.cameraPosition[0], 
                         this.cameraPosition[1], 
                         this.cameraPosition[2]);
        
        // Draw the quad
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
}