import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import cvReady from '@techstark/opencv-js';

function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

async function loadRgbaRaw(inputPath: string): Promise<{ width: number; height: number; data: Uint8Array }> {
  const absIn = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absIn)) throw new Error(`Input image not found: ${absIn}`);
  const { data, info } = await sharp(absIn).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
}

async function saveRgbaRawAsPng(width: number, height: number, data: Uint8Array, outPath: string) {
  const absOut = path.resolve(process.cwd(), outPath);
  ensureDir(path.dirname(absOut));
  await sharp(data, { raw: { width, height, channels: 4 } }).png().toFile(absOut);
}

function drawBoundingBoxesOnMatRGBA(cv: any, rgbaMat: any, minArea: number) {
  const boxes: Array<{ x: number; y: number; w: number; h: number; angle?: number }> = [];
  // Kernel sizes scale with image size when not set explicitly
  const blurK = 7;
  const closeK = Math.max(1, Math.floor(Math.max(rgbaMat.rows, rgbaMat.cols) * 0.01));
  const dilateK = Math.max(1, Math.floor(Math.max(rgbaMat.rows, rgbaMat.cols) * 0.006));

  const gray = new cv.Mat();
  const blurredGray = new cv.Mat();
  const bin = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.cvtColor(rgbaMat, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurredGray, new cv.Size(blurK, blurK), 0, 0, cv.BORDER_DEFAULT);
    cv.threshold(blurredGray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

    const closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeK, closeK));
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, closeKernel);
    closeKernel.delete();

    const dilateKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(dilateK, dilateK));
    cv.dilate(bin, bin, dilateKernel);
    dilateKernel.delete();

    cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const imgArea = rgbaMat.rows * rgbaMat.cols;
    const maxAreaRatio = 0.7;
    const minAreaRatio = 0.003;

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt, false);
      if (area >= Math.max(minArea, imgArea * minAreaRatio) && area <= imgArea * maxAreaRatio) {
        const rr = cv.minAreaRect(cnt);
        const pts = cv.RotatedRect.points(rr);
        for (let j = 0; j < 4; j++) {
          const p1 = pts[j];
          const p2 = pts[(j + 1) % 4];
          cv.line(rgbaMat, new cv.Point(p1.x, p1.y), new cv.Point(p2.x, p2.y), new cv.Scalar(0, 255, 0, 255), 6);
        }
        boxes.push({ x: rr.center.x, y: rr.center.y, w: rr.size.width, h: rr.size.height, angle: rr.angle });
      }
      cnt.delete();
    }
  } finally {
    gray.delete();
    blurredGray.delete();
    bin.delete();
    contours.delete();
    hierarchy.delete();
  }
  return boxes;
}

async function main() {
  const defaultInput = 'tasks/S04E05/context/notatnik-rafala_page19.png';
  const inputPath = process.argv[2] || defaultInput;
  const outputPath = process.argv[3] || inputPath.replace(/\.png$/i, '.boxes.png');

  const raw = await loadRgbaRaw(inputPath);

  const cv = await cvReady;
  const mat = new cv.Mat(raw.height, raw.width, cv.CV_8UC4);
  mat.data.set(raw.data);

  const minArea = Math.floor((raw.width * raw.height) * 0.003);

  const boxes = drawBoundingBoxesOnMatRGBA(cv, mat, minArea);

  await saveRgbaRawAsPng(mat.cols, mat.rows, new Uint8Array(mat.data), outputPath);

  console.log(`Detected boxes: ${boxes.length}`);
  for (const b of boxes) console.log(`- x=${b.x}, y=${b.y}, w=${b.w}, h=${b.h}`);
  console.log(`Saved output with boxes: ${path.resolve(process.cwd(), outputPath)}`);

  mat.delete();
}

main().catch((err) => {
  console.error('Error during scrap detection:', err);
  process.exit(1);
});


