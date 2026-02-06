// Simple DICOM parser for browser
class DicomParser {
    constructor() {
        // Common DICOM tags we need
        this.tags = {
            '00080018': 'SOPInstanceUID',
            '00200013': 'InstanceNumber',
            '00280010': 'Rows',
            '00280011': 'Columns',
            '00280100': 'BitsAllocated',
            '00280101': 'BitsStored',
            '00281050': 'WindowCenter',
            '00281051': 'WindowWidth',
            '00280030': 'PixelSpacing',
            '00200032': 'ImagePositionPatient',
            '00200037': 'ImageOrientationPatient',
            '7FE00010': 'PixelData'
        };
    }

    // Parse a single DICOM file
    async parseDicom(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Check for DICOM magic word at offset 128
        let offset = 0;
        
        // Skip preamble (128 bytes) and magic word ('DICM')
        if (arrayBuffer.byteLength > 132) {
            const magicWord = String.fromCharCode(
                view.getUint8(128),
                view.getUint8(129),
                view.getUint8(130),
                view.getUint8(131)
            );
            
            if (magicWord === 'DICM') {
                offset = 132;
            } else {
                offset = 0; // Raw DICOM without preamble
            }
        }
        
        const metadata = {};
        let pixelData = null;
        let rows = 0;
        let columns = 0;
        
        // Parse DICOM tags
        while (offset < arrayBuffer.byteLength - 8) {
            try {
                const group = view.getUint16(offset, true).toString(16).padStart(4, '0');
                const element = view.getUint16(offset + 2, true).toString(16).padStart(4, '0');
                const tag = group + element;
                
                const vr = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5));
                let length, valueOffset;
                
                if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
                    // Implicit VR length is 4 bytes
                    offset += 6;
                    if (view.getUint32(offset, true) !== 0x00000000) {
                        // Group Length follows
                        offset += 4;
                    }
                    length = view.getUint32(offset, true);
                    offset += 4;
                    valueOffset = offset;
                } else {
                    // Explicit VR
                    offset += 6;
                    if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vr)) {
                        offset += 2; // Padding
                        length = view.getUint32(offset, true);
                        offset += 4;
                        valueOffset = offset;
                    } else {
                        length = view.getUint16(offset, true);
                        offset += 2;
                        valueOffset = offset;
                    }
                }
                
                if (tag === '7FE00010') { // PixelData
                    // Extract pixel data
                    if (vr === 'OW' || vr === 'OB') {
                        if (metadata['00280100'] === 16) { // 16-bit data
                            pixelData = new Uint16Array(arrayBuffer.slice(valueOffset, valueOffset + length));
                        } else {
                            pixelData = new Uint8Array(arrayBuffer.slice(valueOffset, valueOffset + length));
                        }
                    }
                } else if (tag === '00280010') { // Rows
                    metadata[tag] = view.getUint16(valueOffset, true);
                    rows = metadata[tag];
                } else if (tag === '00280011') { // Columns
                    metadata[tag] = view.getUint16(valueOffset, true);
                    columns = metadata[tag];
                } else if (tag === '00280100') { // BitsAllocated
                    metadata[tag] = view.getUint16(valueOffset, true);
                } else if (tag === '00281050') { // WindowCenter
                    if (length === 2) {
                        metadata[tag] = view.getInt16(valueOffset, true);
                    } else if (length === 4) {
                        metadata[tag] = view.getInt32(valueOffset, true);
                    }
                } else if (tag === '00281051') { // WindowWidth
                    if (length === 2) {
                        metadata[tag] = view.getUint16(valueOffset, true);
                    } else if (length === 4) {
                        metadata[tag] = view.getUint32(valueOffset, true);
                    }
                } else if (tag === '00200013') { // InstanceNumber
                    metadata[tag] = view.getUint16(valueOffset, true);
                }
                
                // Move to next tag
                offset = valueOffset + length;
                
                // Align to even boundary
                if (length % 2 === 1 && vr !== 'SQ' && vr !== 'UT') {
                    offset += 1;
                }
            } catch (e) {
                console.warn('Error parsing DICOM tag at offset', offset, ':', e);
                break;
            }
        }
        
        return {
            metadata,
            pixelData,
            rows,
            columns
        };
    }

    // Process a folder of DICOM files into a 3D volume
    async processDicomFolder(files) {
        const slices = [];
        
        // Parse all DICOM files
        for (const file of files) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const dicomData = await this.parseDicom(arrayBuffer);
                
                if (dicomData.pixelData && dicomData.rows && dicomData.columns) {
                    slices.push({
                        data: dicomData.pixelData,
                        metadata: dicomData.metadata,
                        rows: dicomData.rows,
                        columns: dicomData.columns,
                        instanceNumber: dicomData.metadata['00200013'] || 0
                    });
                }
            } catch (e) {
                console.warn('Error parsing DICOM file', file.name, ':', e);
            }
        }
        
        if (slices.length === 0) {
            throw new Error('No valid DICOM files found');
        }
        
        // Sort slices by instance number
        slices.sort((a, b) => (a.instanceNumber || 0) - (b.instanceNumber || 0));
        
        // Create 3D volume
        const rows = slices[0].rows;
        const cols = slices[0].columns;
        const depth = slices.length;
        
        // Determine data type based on first slice
        const is16Bit = slices[0].data instanceof Uint16Array;
        const volumeSize = rows * cols * depth;
        
        let volumeData;
        if (is16Bit) {
            volumeData = new Uint16Array(volumeSize);
        } else {
            volumeData = new Uint8Array(volumeSize);
        }
        
        // Fill volume data
        for (let z = 0; z < depth; z++) {
            const sliceData = slices[z].data;
            const sliceSize = rows * cols;
            
            for (let i = 0; i < sliceSize; i++) {
                volumeData[z * sliceSize + i] = sliceData[i];
            }
        }
        
        // Normalize 16-bit data to 8-bit if needed
        if (is16Bit) {
            const maxVal = Math.max(...volumeData);
            const minVal = Math.min(...volumeData);
            const range = maxVal - minVal || 1;
            
            const normalizedVolume = new Uint8Array(volumeSize);
            for (let i = 0; i < volumeSize; i++) {
                normalizedVolume[i] = Math.round(((volumeData[i] - minVal) / range) * 255);
            }
            
            volumeData = normalizedVolume;
        }
        
        return {
            data: volumeData,
            dimensions: [cols, rows, depth]
        };
    }
}