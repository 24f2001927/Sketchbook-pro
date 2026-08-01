import type { LayerNode } from '../../state/document';
import { ExportEngine } from '../canvas/ExportEngine';

export interface PDFExportOptions {
  layerSelection: 'all' | 'vector_only' | 'text_only' | 'raster_only';
  pageArea: 'active_content' | 'full_canvas';
  orientation: 'auto' | 'portrait' | 'landscape';
  resolutionDPI: 150 | 300;
  pdfTitle: string;
  author: string;
}

export class PDFEngine {
  // Dynamically load Mozilla PDF.js library for native client-side PDF document rendering
  private static async loadPdfJs(): Promise<any> {
    if ((window as any).pdfjsLib) {
      return (window as any).pdfjsLib;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.onload = () => {
        const lib = (window as any).pdfjsLib;
        if (lib) {
          lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          resolve(lib);
        } else {
          reject(new Error('PDF.js library initialized but handle missing'));
        }
      };
      script.onerror = () => reject(new Error('Failed to load PDF.js script from CDN'));
      document.head.appendChild(script);
    });
  }

  // Convert Canvas Image Data into a Valid Binary PDF-1.4 Document Blob
  public static async createPDFFromCanvas(
    canvas: HTMLCanvasElement,
    title = 'Sketchbook Pro Artwork',
    author = 'Sketchbook Pro User'
  ): Promise<Blob> {
    const imgWidth = canvas.width;
    const imgHeight = canvas.height;

    // Convert Canvas to JPEG Data URL for PDF Stream Compression
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const base64Data = jpegDataUrl.split(',')[1];
    const binaryJpeg = atob(base64Data);

    const jpegLength = binaryJpeg.length;
    const jpegBytes = new Uint8Array(jpegLength);
    for (let i = 0; i < jpegLength; i++) {
      jpegBytes[i] = binaryJpeg.charCodeAt(i);
    }

    // Convert dimensions from pixels to PDF Points (72 points per inch)
    const ptWidth = Math.round((imgWidth / 96) * 72);
    const ptHeight = Math.round((imgHeight / 96) * 72);

    // Build PDF Object Structure
    const pdfParts: Uint8Array[] = [];
    const offsets: number[] = [0];

    const encoder = new TextEncoder();
    const writeString = (str: string) => {
      const bytes = encoder.encode(str);
      pdfParts.push(bytes);
      offsets.push(offsets[offsets.length - 1] + bytes.length);
    };

    const writeBytes = (bytes: Uint8Array) => {
      pdfParts.push(bytes);
      offsets.push(offsets[offsets.length - 1] + bytes.length);
    };

    // 1. Header
    writeString('%PDF-1.4\n%âãÏÓ\n');

    // 2. Object 1: Catalog
    const obj1Offset = offsets[offsets.length - 1];
    writeString('1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n');

    // 3. Object 2: Pages Tree
    const obj2Offset = offsets[offsets.length - 1];
    writeString('2 0 obj\n<</Type /Pages /Count 1 /Kids [3 0 R]>>\nendobj\n');

    // 4. Object 3: Page Definition
    const obj3Offset = offsets[offsets.length - 1];
    writeString(`3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Resources <</XObject <</Im1 4 0 R>>>> /Contents 5 0 R>>\nendobj\n`);

    // 5. Object 4: Image XObject Stream
    const obj4Offset = offsets[offsets.length - 1];
    const imgHeader = `4 0 obj\n<</Type /XObject /Subtype /Image /Width ${imgWidth} /Height ${imgHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegLength}>>\nstream\n`;
    writeString(imgHeader);
    writeBytes(jpegBytes);
    writeString('\nendstream\nendobj\n');

    // 6. Object 5: Drawing Content Stream
    const obj5Offset = offsets[offsets.length - 1];
    const streamContent = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im1 Do Q`;
    const streamLength = encoder.encode(streamContent).length;
    writeString(`5 0 obj\n<</Length ${streamLength}>>\nstream\n${streamContent}\nendstream\nendobj\n`);

    // 7. Object 6: Info Metadata
    const obj6Offset = offsets[offsets.length - 1];
    writeString(`6 0 obj\n<</Title (${title}) /Author (${author}) /Producer (Sketchbook Pro PDF Engine) /CreationDate (D:${new Date().toISOString().replace(/[-T:\.Z]/g, '').slice(0, 14)})>>\nendobj\n`);

    // 8. XRef Table
    const xrefOffset = offsets[offsets.length - 1];
    let xref = `xref\n0 7\n0000000000 65535 f \n`;
    xref += `${obj1Offset.toString().padStart(10, '0')} 00000 n \n`;
    xref += `${obj2Offset.toString().padStart(10, '0')} 00000 n \n`;
    xref += `${obj3Offset.toString().padStart(10, '0')} 00000 n \n`;
    xref += `${obj4Offset.toString().padStart(10, '0')} 00000 n \n`;
    xref += `${obj5Offset.toString().padStart(10, '0')} 00000 n \n`;
    xref += `${obj6Offset.toString().padStart(10, '0')} 00000 n \n`;
    writeString(xref);

    // 9. Trailer
    writeString(`trailer\n<</Size 7 /Root 1 0 R /Info 6 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    // Combine all parts into single PDF Blob
    const totalLength = pdfParts.reduce((sum, p) => sum + p.length, 0);
    const finalBuffer = new Uint8Array(totalLength);
    let currentOffset = 0;
    for (const part of pdfParts) {
      finalBuffer.set(part, currentOffset);
      currentOffset += part.length;
    }

    return new Blob([finalBuffer], { type: 'application/pdf' });
  }

  // Export PDF with Custom User Selection Options
  public static async exportPDFWithOptions(
    layers: LayerNode[],
    canvasWidth: number,
    canvasHeight: number,
    options: PDFExportOptions
  ): Promise<Blob> {
    // Filter layers based on user selection
    const filteredLayers = layers.filter(layer => {
      if (!layer.visible) return false;
      if (options.layerSelection === 'vector_only') return layer.type === 'vector';
      if (options.layerSelection === 'text_only') return layer.type === 'text';
      if (options.layerSelection === 'raster_only') return layer.type === 'raster';
      return true;
    });

    const scaleFactor = options.resolutionDPI === 300 ? 2.0 : 1.0;
    const cropToContent = options.pageArea === 'active_content';

    const flatCanvas = ExportEngine.flattenDocument(filteredLayers, canvasWidth, canvasHeight, scaleFactor);

    let renderCanvas = flatCanvas;

    if (cropToContent) {
      const bbox = ExportEngine.getContentBoundingBox(filteredLayers, canvasWidth, canvasHeight, 16);
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.round(bbox.w * scaleFactor);
      cropCanvas.height = Math.round(bbox.h * scaleFactor);
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.drawImage(
        flatCanvas,
        bbox.x * scaleFactor,
        bbox.y * scaleFactor,
        bbox.w * scaleFactor,
        bbox.h * scaleFactor,
        0, 0,
        cropCanvas.width,
        cropCanvas.height
      );
      renderCanvas = cropCanvas;
    }

    return this.createPDFFromCanvas(renderCanvas, options.pdfTitle, options.author);
  }

  // Import PDF Document or Page Image into Canvas Document Stack
  public static async importPDFPageToLayer(
    file: File,
    canvasWidth: number,
    canvasHeight: number
  ): Promise<{ newLayer: LayerNode; srcUrl: string }> {
    const isPDF = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

    if (isPDF) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await this.loadPdfJs();
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;

        // Render Page 1 of PDF onto HTML5 Canvas
        const page = await pdfDoc.getPage(1);
        const initialViewport = page.getViewport({ scale: 1.0 });

        const scale = Math.min(canvasWidth / initialViewport.width, canvasHeight / initialViewport.height, 2.0);
        const viewport = page.getViewport({ scale });

        const pdfCanvas = document.createElement('canvas');
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        const pdfCtx = pdfCanvas.getContext('2d')!;

        await page.render({ canvasContext: pdfCtx, viewport }).promise;

        const srcUrl = pdfCanvas.toDataURL('image/png');
        const origW = viewport.width;
        const origH = viewport.height;

        const newImgNode = {
          id: `img-pdf-${Date.now()}`,
          src: srcUrl,
          x: Math.max(0, (canvasWidth - origW) / 2),
          y: Math.max(0, (canvasHeight - origH) / 2),
          width: Math.min(canvasWidth, origW),
          height: Math.min(canvasHeight, origH),
          rotation: 0,
        };

        const newLayer: LayerNode = {
          id: `layer-pdf-${Date.now()}`,
          name: `Imported PDF Page 1 (${file.name})`,
          type: 'image',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          clipping: false,
          parentId: null,
          imageNode: newImgNode,
        };

        return { newLayer, srcUrl };
      } catch (err) {
        console.warn('PDF.js rendering fallback triggered:', err);
      }
    }

    // Image File Import Fallback (.png, .jpg, .webp)
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        if (typeof evt.target?.result === 'string') {
          const srcUrl = evt.target.result;
          const img = new Image();
          img.src = srcUrl;
          img.onload = () => {
            const origW = img.naturalWidth || img.width || 800;
            const origH = img.naturalHeight || img.height || 1000;

            const newImgNode = {
              id: `img-pdf-${Date.now()}`,
              src: srcUrl,
              x: Math.max(0, (canvasWidth - origW) / 2),
              y: Math.max(0, (canvasHeight - origH) / 2),
              width: Math.min(canvasWidth, origW),
              height: Math.min(canvasHeight, origH),
              rotation: 0,
            };

            const newLayer: LayerNode = {
              id: `layer-pdf-${Date.now()}`,
              name: `Imported Page Image (${file.name})`,
              type: 'image',
              visible: true,
              opacity: 1,
              blendMode: 'normal',
              clipping: false,
              parentId: null,
              imageNode: newImgNode,
            };

            resolve({ newLayer, srcUrl });
          };
          img.onerror = () => reject(new Error('Failed to load image file'));
        }
      };
      reader.readAsDataURL(file);
    });
  }
}
