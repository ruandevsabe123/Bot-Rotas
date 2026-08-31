import { readRouteImageOcr } from "./ocr";
import { acquireGlobalOcrLock } from "./ocrGlobalLock";
import { getOrCreateSharedOcrResult, SharedOcrOptions } from "./ocrSharedCache";

export function readRouteImageOcrCoordinated(imagePath: string, options: SharedOcrOptions = {}) {
  return getOrCreateSharedOcrResult(imagePath, options, async () => {
    const release = await acquireGlobalOcrLock();
    try {
      return await readRouteImageOcr(imagePath, options);
    } finally {
      await release();
    }
  });
}
