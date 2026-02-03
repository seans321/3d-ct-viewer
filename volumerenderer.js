class VolumeRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        
        if (!this.gl) {
            throw new Error('WebGL not supported');
        }
        
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
            varying vec3 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                
                // Map position to texture coordinates
                v_texCoord = vec3((a_position.x + 1.0) / 2.0, 
                                  (a_position.y + 1.0) / 2.0, 
                                  0.5);
            }
        `;
        
        // Fragment shader for ray marching volume rendering
        const fragmentShaderSource = `
            precision highp float;
            
            varying vec3 v_texCoord;
            uniform sampler3D u_volumeTexture;
            uniform float u_threshold;
            uniform float u_opacity;
            uniform vec3 u_viewDir;
            uniform vec3 u_lightPos;
            uniform vec3 u_cameraPos;
            
            void main() {
                vec3 rayDir = normalize(u_viewDir);
                vec3 rayStart = v_texCoord;
                
                // Simple ray marching
                vec4 colorAccum = vec4(0.0);
                vec3 rayStep = rayDir * 0.01;
                vec3 currentPos = rayStart;
                
                // March along the ray
                for (int i = 0; i < 200; i++) {
                    // Sample the volume
                    float density = texture3D(u_volumeTexture, currentPos).r;
                    
                    if (density > u_threshold / 255.0) {
                        // Calculate basic lighting
                        float intensity = (density - u_threshold / 255.0) / (1.0 - u_threshold / 255.0);
                        
                        // Simple Phong-like lighting
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
                    
                    currentPos += rayStep;
                    
                    // Check bounds
                    if (currentPos.x < 0.0 || currentPos.x > 1.0 ||
                        currentPos.y < 0.0 || currentPos.y > 1.0 ||
                        currentPos.z < 0.0 || currentPos.z > 1.0) {
                        break;
                    }
                }
                
                gl_FragColor = clamp(colorAccum, 0.0, 1.0);
            }
        `;
        
        this.vertexShader = this.createShader(this.gl.VERTEX_SHADER, vertexShaderSource);
        this.fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, fragmentShaderSource);
        
        this.program = this.createProgram(this.vertexShader, this.fragmentShader);
    }
    
    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Shader compilation error:', this.gl.getShaderInfoLog(shader));
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
        // Create 3D texture for volume data
        this.volumeTexture = this.gl.createTexture();
    }
    
    setupUniforms() {
        // Get uniform locations
        this.gl.useProgram(this.program);
        this.uniformLocations = {
            volumeTexture: this.gl.getUniformLocation(this.program, 'u_volumeTexture'),
            threshold: this.gl.getUniformLocation(this.program, 'u_threshold'),
            opacity: this.gl.getUniformLocation(this.program, 'u_opacity'),
            viewDir: this.gl.getUniformLocation(this.program, 'u_viewDir'),
            lightPos: this.gl.getUniformLocation(this.program, 'u_lightPos'),
            cameraPos: this.gl.getUniformLocation(this.program, 'u_cameraPos')
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
        
        // Upload volume data to 3D texture
        this.gl.bindTexture(this.gl.TEXTURE_3D, this.volumeTexture);
        
        // Set texture parameters
        this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_WRAP_R, this.gl.CLAMP_TO_EDGE);
        
        // Upload texture data
        this.gl.texImage3D(
            this.gl.TEXTURE_3D,    // target
            0,                     // level
            this.gl.R8,            // internalformat
            volumeData.dimensions[0], // width
            volumeData.dimensions[1], // height
            volumeData.dimensions[2], // depth
            0,                     // border
            this.gl.RED,           // format
            this.gl.UNSIGNED_BYTE, // type
            volumeData.data        // data
        );
        
        this.volumeDimensions = volumeData.dimensions;
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
        if (!this.volumeData) return;
        
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
        this.gl.bindTexture(this.gl.TEXTURE_3D, this.volumeTexture);
        this.gl.uniform1i(this.uniformLocations.volumeTexture, 0);
        
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

// Helper function for 3D textures (WebGL1 doesn't support them natively)
function texture3D(gl, texture, xoffset, yoffset, zoffset, width, height, depth, format, type, p) {
    // For WebGL2, use texSubImage3D
    if (gl.texSubImage3D) {
        gl.texSubImage3D(gl.TEXTURE_3D, 0, xoffset, yoffset, zoffset, width, height, depth, format, type, p);
    }
}