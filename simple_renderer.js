// Simple volume renderer that ensures basic functionality works
class SimpleVolumeRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
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
        this.cameraRotation = [0, 0];
        
        // Initialize volume properties
        this.threshold = 100;
        this.opacity = 0.8;
        this.windowLevel = 128;
        this.windowWidth = 256;
        this.volumeData = null;
        this.volumeTexture = null;
        
        // Mouse interaction
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        
        this.setupMouseHandlers();
    }
    
    setupShaders() {
        // Simple vertex shader
        const vertexShaderSource = `
            attribute vec2 a_position;
            varying vec2 v_texCoord;
            
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = (a_position + 1.0) * 0.5;
            }
        `;
        
        // Simplified fragment shader that at least shows something
        const fragmentShaderSource = `
            precision mediump float;
            
            varying vec2 v_texCoord;
            uniform sampler2D u_volumeTexture;
            uniform float u_textureWidth;
            uniform float u_textureHeight;
            uniform float u_slices;
            uniform float u_threshold;
            uniform float u_opacity;
            uniform float u_windowLevel;
            uniform float u_windowWidth;
            uniform vec3 u_volumeSize;
            
            void main() {
                // If no texture is bound, show a simple pattern
                if (u_slices <= 0.0) {
                    // Create a simple pattern so we know the shader is working
                    float r = sin(v_texCoord.x * 10.0) * 0.5 + 0.5;
                    float g = cos(v_texCoord.y * 10.0) * 0.5 + 0.5;
                    float b = sin((v_texCoord.x + v_texCoord.y) * 5.0) * 0.5 + 0.5;
                    gl_FragColor = vec4(r, g, b, 1.0);
                    return;
                }
                
                // Sample the volume texture at the center slice for now
                float sliceCenter = u_slices * 0.5;
                vec2 uv = v_texCoord;
                
                // Calculate texture coordinates accounting for slice layout
                float slicesPerRow = u_textureWidth / u_volumeSize.x;
                float row = floor(sliceCenter / slicesPerRow);
                float col = mod(sliceCenter, slicesPerRow);
                
                vec2 sliceSize = vec2(u_volumeSize.x / u_textureWidth, u_volumeSize.y / u_textureHeight);
                vec2 sliceOffset = vec2(col * u_volumeSize.x / u_textureWidth, row * u_volumeSize.y / u_textureHeight);
                
                uv = uv * sliceSize + sliceOffset;
                
                float density = texture2D(u_volumeTexture, uv).r;
                
                // Apply window level and window width transformation
                float windowMin = u_windowLevel - u_windowWidth * 0.5;
                float windowMax = u_windowLevel + u_windowWidth * 0.5;
                
                float normalizedDensity = (density - windowMin) / (windowMax - windowMin);
                normalizedDensity = clamp(normalizedDensity, 0.0, 1.0);
                
                float intensity = step(u_threshold / 255.0, normalizedDensity) * normalizedDensity;
                
                gl_FragColor = vec4(vec3(intensity), intensity * u_opacity);
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
        this.volumeTexture = this.gl.createTexture();
    }
    
    setupUniforms() {
        this.gl.useProgram(this.program);
        this.uniformLocations = {
            volumeTexture: this.gl.getUniformLocation(this.program, 'u_volumeTexture'),
            textureWidth: this.gl.getUniformLocation(this.program, 'u_textureWidth'),
            textureHeight: this.gl.getUniformLocation(this.program, 'u_textureHeight'),
            slices: this.gl.getUniformLocation(this.program, 'u_slices'),
            threshold: this.gl.getUniformLocation(this.program, 'u_threshold'),
            opacity: this.gl.getUniformLocation(this.program, 'u_opacity'),
            windowLevel: this.gl.getUniformLocation(this.program, 'u_windowLevel'),
            windowWidth: this.gl.getUniformLocation(this.program, 'u_windowWidth'),
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
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
        });
    }
    
    loadVolume(volumeData) {
        this.volumeData = volumeData;
        
        const [width, height, depth] = volumeData.dimensions;
        
        // Calculate texture layout
        const slicesPerRow = Math.ceil(Math.sqrt(depth));
        const rows = Math.ceil(depth / slicesPerRow);
        
        const texWidth = slicesPerRow * width;
        const texHeight = rows * height;
        
        // Create texture data
        const textureData = new Uint8Array(texWidth * texHeight);
        
        // Fill texture data
        for (let z = 0; z < depth; z++) {
            const sliceRow = Math.floor(z / slicesPerRow);
            const sliceCol = z % slicesPerRow;
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const volumeIdx = z * width * height + y * width + x;
                    const texX = sliceCol * width + x;
                    const texY = sliceRow * height + y;
                    const texIdx = texY * texWidth + texX;
                    
                    textureData[texIdx] = Math.max(0, Math.min(255, Math.round(volumeData.data[volumeIdx])));
                }
            }
        }
        
        // Upload texture
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
        
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.LUMINANCE,
            texWidth,
            texHeight,
            0,
            this.gl.LUMINANCE,
            this.gl.UNSIGNED_BYTE,
            textureData
        );
        
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
    
    setWindowLevel(value) {
        this.windowLevel = value;
    }
    
    setWindowWidth(value) {
        this.windowWidth = value;
    }
    
    render() {
        if (!this.program) return;
        
        this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        this.gl.clearColor(0.0, 0.0, 0.0, 1.0);
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        
        this.gl.useProgram(this.program);
        
        this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
        const positionAttributeLocation = this.gl.getAttribLocation(this.program, 'a_position');
        this.gl.enableVertexAttribArray(positionAttributeLocation);
        this.gl.vertexAttribPointer(positionAttributeLocation, 2, this.gl.FLOAT, false, 0, 0);
        
        // Bind texture and set uniforms
        if (this.volumeTexture && this.textureLayout) {
            this.gl.activeTexture(this.gl.TEXTURE0);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.volumeTexture);
            this.gl.uniform1i(this.uniformLocations.volumeTexture, 0);
            
            this.gl.uniform1f(this.uniformLocations.textureWidth, this.textureLayout.width);
            this.gl.uniform1f(this.uniformLocations.textureHeight, this.textureLayout.height);
            this.gl.uniform1f(this.uniformLocations.slices, this.textureLayout.slices);
            this.gl.uniform3f(this.uniformLocations.volumeSize, 
                             this.textureLayout.volumeSize[0],
                             this.textureLayout.volumeSize[1],
                             this.textureLayout.volumeSize[2]);
        } else {
            // If no volume loaded, pass zeros to avoid errors
            this.gl.uniform1f(this.uniformLocations.slices, 0);
        }
        
        this.gl.uniform1f(this.uniformLocations.threshold, this.threshold);
        this.gl.uniform1f(this.uniformLocations.opacity, this.opacity);
        this.gl.uniform1f(this.uniformLocations.windowLevel, this.windowLevel);
        this.gl.uniform1f(this.uniformLocations.windowWidth, this.windowWidth);
        
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    }
}

// Animation loop
function startRendering(renderer) {
    function animate() {
        renderer.render();
        requestAnimationFrame(animate);
    }
    animate();
}