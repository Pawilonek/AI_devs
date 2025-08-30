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

function orderRectPoints(pts: any[]): [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] | null {
  if (!Array.isArray(pts) || pts.length !== 4) return null;
  const sortedByY = [...pts].sort((a, b) => a.y - b.y);
  const topTwo = sortedByY.slice(0, 2).sort((a, b) => a.x - b.x); // left->right
  const bottomTwo = sortedByY.slice(2, 4).sort((a, b) => a.x - b.x); // left->right
  const topLeft = topTwo[0];
  const topRight = topTwo[1];
  const bottomLeft = bottomTwo[0];
  const bottomRight = bottomTwo[1];
  return [{ x: topLeft.x, y: topLeft.y }, { x: topRight.x, y: topRight.y }, { x: bottomRight.x, y: bottomRight.y }, { x: bottomLeft.x, y: bottomLeft.y }];
}

function drawBoundingBoxesOnMatRGBA(cv: any, rgbaMat: any, minArea: number) {
  const boxes: Array<{ x: number; y: number; w: number; h: number; angle?: number }> = [];
  const quads: Array<Array<{ x: number; y: number }>> = [];
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
        const ptsRaw = cv.RotatedRect.points(rr) as any[];
        const pts = orderRectPoints(ptsRaw);
        if (pts) {
          const [tl, tr, br, bl] = pts;
          cv.line(rgbaMat, new cv.Point(tl.x, tl.y), new cv.Point(tr.x, tr.y), new cv.Scalar(0, 255, 0, 255), 6);
          cv.line(rgbaMat, new cv.Point(tr.x, tr.y), new cv.Point(br.x, br.y), new cv.Scalar(0, 255, 0, 255), 6);
          cv.line(rgbaMat, new cv.Point(br.x, br.y), new cv.Point(bl.x, bl.y), new cv.Scalar(0, 255, 0, 255), 6);
          cv.line(rgbaMat, new cv.Point(bl.x, bl.y), new cv.Point(tl.x, tl.y), new cv.Scalar(0, 255, 0, 255), 6);
          boxes.push({ x: rr.center.x, y: rr.center.y, w: rr.size.width, h: rr.size.height, angle: rr.angle });
          quads.push(pts);
        }
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
  return { boxes, quads };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

async function extractAndSaveFragments(cv: any, rgbaMat: any, quads: Array<Array<{ x: number; y: number }>>, outDir: string) {
  ensureDir(outDir);
  for (let i = 0; i < quads.length; i++) {
    const pts = quads[i];
    if (!pts || pts.length !== 4) continue;
    const [tl, tr, br, bl] = orderRectPoints(pts as any) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    // Use ordered points: [topLeft, topRight, bottomRight, bottomLeft]
    const height1 = distance(tl, bl);
    const height2 = distance(tr, br);
    const width1 = distance(tl, tr);
    const width2 = distance(bl, br);
    const width = Math.max(1, Math.round(Math.max(width1, width2)));
    const height = Math.max(1, Math.round(Math.max(height1, height2)));

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, new Float32Array([
      tl.x, tl.y, // top-left
      tr.x, tr.y, // top-right
      br.x, br.y, // bottom-right
      bl.x, bl.y  // bottom-left
    ]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, new Float32Array([
      0, 0,
      width - 1, 0,
      width - 1, height - 1,
      0, height - 1
    ]));
    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(rgbaMat, dst, M, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());

    const outPath = path.join(outDir, `fragment_${String(i + 1).padStart(3, '0')}.png`);
    await saveRgbaRawAsPng(dst.cols, dst.rows, new Uint8Array(dst.data), outPath);

    srcTri.delete();
    dstTri.delete();
    M.delete();
    dst.delete();
  }
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

  const { boxes, quads } = drawBoundingBoxesOnMatRGBA(cv, mat, minArea);

  await saveRgbaRawAsPng(mat.cols, mat.rows, new Uint8Array(mat.data), outputPath);

  const fragmentsDir = path.join(path.dirname(outputPath), 'fragments');
  await extractAndSaveFragments(cv, mat, quads, fragmentsDir);

  console.log(`Detected boxes: ${boxes.length}`);
  for (const b of boxes) console.log(`- x=${b.x}, y=${b.y}, w=${b.w}, h=${b.h}`);
  console.log(`Saved output with boxes: ${path.resolve(process.cwd(), outputPath)}`);
  console.log(`Saved fragments to: ${path.resolve(process.cwd(), fragmentsDir)}`);

  mat.delete();
}

main().catch((err) => {
  console.error('Error during scrap detection:', err);
  process.exit(1);
});


