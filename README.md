# 3D CT Viewer

A high-performance 3D volume renderer for medical CT scans built with WebGL and JavaScript. This viewer allows you to visualize 3D medical imaging data directly in your browser with interactive controls.

## Features

- Real-time 3D volume rendering using ray marching algorithm
- Interactive controls for threshold and opacity adjustment
- Mouse-based rotation and zoom
- Support for simulated medical volume data
- Optimized performance with WebGL shaders

## Technologies Used

- WebGL (Web Graphics Library)
- JavaScript
- HTML5 Canvas
- GLSL (OpenGL Shading Language)
- Ray marching algorithm for volume rendering

## How to Use

1. Open the viewer in a modern web browser
2. Click "Load Sample" to load a pre-built 3D volume dataset
3. Adjust the threshold slider to control which densities are visible
4. Adjust opacity to control transparency
5. Click and drag to rotate the 3D view
6. Use mouse wheel to zoom in/out

## Technical Details

The viewer uses a ray marching technique implemented in WebGL fragment shaders for real-time volume rendering. Each pixel on the screen casts rays through the 3D volume data, sampling along the ray path to accumulate color and opacity values.

The implementation includes:
- 3D texture storage for volume data
- Real-time ray marching in fragment shader
- Alpha compositing for proper transparency
- Basic lighting model for enhanced visualization

## Performance Considerations

- Uses optimized ray marching with early termination
- Adjustable ray step size for quality/performance balance
- Efficient GPU-based computation
- Proper WebGL state management

## Future Enhancements

- DICOM file format support
- More advanced transfer functions
- Multi-planar reconstruction views
- Measurement tools
- Different rendering modes (MIP, surface rendering)

## License

This project is released under the MIT License - see the LICENSE file for details.