import type { User } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';
import { db, storage } from '../firebase/config';
import { OperationType, handleFirestoreError } from '../firebase/errors';

export interface UploadedPhoto {
  url: string;
  path: string;
}

export interface CompressedPhoto {
  blob: Blob;
  mimeType: 'image/webp' | 'image/jpeg';
  sizeBytes: number;
  previewUrl: string;
}

const MAX_DIMENSION = 1080;
const TARGET_MAX_BYTES = 160 * 1024;
const HARD_MAX_BYTES = 240 * 1024;

// In-memory cache & deduplicated inflight map for fsphoto:{id} URLs
const photoDataUrlCache = new Map<string, string>();
const inflightPhotoFetches = new Map<string, Promise<string | null>>();

let storageBucketAvailable: boolean | null = null;
let storageProbePromise: Promise<boolean> | null = null;

function supportsWebP(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

const PREFERRED_MIME: 'image/webp' | 'image/jpeg' = supportsWebP() ? 'image/webp' : 'image/jpeg';

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not process photo data.'));
    reader.readAsDataURL(blob);
  });
}

async function decodeImageSource(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        cleanup: () => URL.revokeObjectURL(objectUrl),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not read the selected image file.'));
    };
    img.src = objectUrl;
  });
}

export async function compressImageToTarget(file: File): Promise<CompressedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select a valid image file.');
  }

  const source = await decodeImageSource(file);
  try {
    let targetW = source.width;
    let targetH = source.height;

    if (targetW > targetH && targetW > MAX_DIMENSION) {
      targetH = Math.max(1, Math.round((targetH * MAX_DIMENSION) / targetW));
      targetW = MAX_DIMENSION;
    } else if (targetH >= targetW && targetH > MAX_DIMENSION) {
      targetW = Math.max(1, Math.round((targetW * MAX_DIMENSION) / targetH));
      targetH = MAX_DIMENSION;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, targetW);
    canvas.height = Math.max(1, targetH);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not initialize image compressor.');
    }

    ctx.drawImage = ctx.drawImage.bind(ctx);
    source.draw(ctx, canvas.width, canvas.height);

    let mime: 'image/webp' | 'image/jpeg' = PREFERRED_MIME;
    let blob = await canvasToBlob(canvas, mime, 0.78);
    if (!blob || (blob.type !== 'image/webp' && blob.type !== 'image/jpeg')) {
      mime = 'image/jpeg';
      blob = await canvasToBlob(canvas, mime, 0.78);
    }

    if (blob && blob.size > TARGET_MAX_BYTES) {
      const lower = await canvasToBlob(canvas, mime, 0.6);
      if (lower && lower.size < blob.size) {
        blob = lower;
      }
    }

    // Extra downscale guard for very dense images
    if (blob && blob.size > HARD_MAX_BYTES) {
      for (const pass of [
        { scale: 0.72, quality: 0.58 },
        { scale: 0.7, quality: 0.48 },
      ]) {
        if (!blob || blob.size <= HARD_MAX_BYTES) break;
        canvas.width = Math.max(1, Math.round(canvas.width * pass.scale));
        canvas.height = Math.max(1, Math.round(canvas.height * pass.scale));
        const ctx2 = canvas.getContext('2d');
        if (ctx2) {
          source.draw(ctx2, canvas.width, canvas.height);
          const smaller = await canvasToBlob(canvas, mime, pass.quality);
          if (smaller && smaller.size < blob.size) {
            blob = smaller;
          }
        }
      }
    }

    if (!blob) {
      throw new Error('Could not compress image.');
    }

    const finalMime: 'image/webp' | 'image/jpeg' =
      blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

    return {
      blob,
      mimeType: finalMime,
      sizeBytes: blob.size,
      previewUrl: URL.createObjectURL(blob),
    };
  } finally {
    source.cleanup();
  }
}

export async function isFirebaseStorageAvailable(): Promise<boolean> {
  if (storageBucketAvailable !== null) return storageBucketAvailable;
  if (storageProbePromise) return storageProbePromise;

  const bucket = firebaseConfig.storageBucket;
  if (!bucket) {
    storageBucketAvailable = false;
    return false;
  }

  storageProbePromise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2000);
    try {
      const res = await fetch(
        `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?maxResults=1`,
        { method: 'GET', signal: controller.signal }
      );
      // 200, 401, or 403 all mean the bucket exists; 404 means Storage is not provisioned
      storageBucketAvailable = res.status !== 404;
      return storageBucketAvailable;
    } catch {
      storageBucketAvailable = false;
      return false;
    } finally {
      window.clearTimeout(timer);
      storageProbePromise = null;
    }
  })();

  return storageProbePromise;
}

// Pre-warm probe in background when form opens
export function warmStorageProbe(): void {
  void isFirebaseStorageAvailable();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise
      .then((val) => {
        window.clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        window.clearTimeout(timer);
        reject(err);
      });
  });
}

async function savePhotoToOrderPhotosCollection(
  orderId: string,
  compressed: CompressedPhoto,
  user: User,
  teamEmails: string[]
): Promise<UploadedPhoto> {
  const photoId = `ph_${orderId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const dataUrl = await blobToDataUrl(compressed.blob);

  if (dataUrl.length > 355000) {
    throw new Error('One of your photos is still too large after compression. Please choose another photo.');
  }

  const photoRef = doc(db, 'orderPhotos', photoId);
  try {
    await setDoc(photoRef, {
      id: photoId,
      orderId,
      dataUrl,
      mimeType: compressed.mimeType,
      sizeBytes: compressed.sizeBytes,
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
      teamEmails,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orderPhotos/${photoId}`);
  }

  const refToken = `fsphoto:${photoId}`;
  photoDataUrlCache.set(refToken, dataUrl);
  return { url: refToken, path: refToken };
}

export async function uploadPreparedOrderPhotos(
  orderId: string,
  photos: CompressedPhoto[],
  user: User,
  teamEmails: string[]
): Promise<UploadedPhoto[]> {
  if (photos.length === 0) return [];
  if (photos.length > 3) {
    throw new Error('You can upload a maximum of 3 photos per order.');
  }

  const useStorage = await isFirebaseStorageAvailable();

  if (useStorage) {
    try {
      const results = await withTimeout(
        Promise.all(
          photos.map(async (photo, index) => {
            const ext = photo.mimeType === 'image/webp' ? 'webp' : 'jpg';
            const rand = Math.random().toString(36).slice(2, 8);
            const path = `orders/${orderId}/${Date.now()}_${index}_${rand}.${ext}`;
            const storageRef = ref(storage, path);
            await uploadBytes(storageRef, photo.blob, {
              contentType: photo.mimeType,
              cacheControl: 'public,max-age=31536000',
            });
            const url = await getDownloadURL(storageRef);
            return { url, path };
          })
        ),
        7000,
        'Storage upload timed out.'
      );
      return results;
    } catch {
      // If Storage bucket rejected/timed out (e.g. unconfigured rules/CORS), mark unavailable & fallback seamlessly
      storageBucketAvailable = false;
    }
  }

  return Promise.all(
    photos.map((photo) => savePhotoToOrderPhotosCollection(orderId, photo, user, teamEmails))
  );
}

export async function resolvePhotoUrl(src: string): Promise<string | null> {
  if (!src) return null;
  if (!src.startsWith('fsphoto:')) return src;

  const cached = photoDataUrlCache.get(src);
  if (cached) return cached;

  const existingFetch = inflightPhotoFetches.get(src);
  if (existingFetch) return existingFetch;

  const photoId = src.slice('fsphoto:'.length);
  const fetchPromise = (async () => {
    try {
      const snap = await getDoc(doc(db, 'orderPhotos', photoId));
      if (!snap.exists()) return null;
      const dataUrl = String(snap.data().dataUrl ?? '');
      if (dataUrl) {
        photoDataUrlCache.set(src, dataUrl);
        return dataUrl;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `orderPhotos/${photoId}`);
    } finally {
      inflightPhotoFetches.delete(src);
    }
  })();

  inflightPhotoFetches.set(src, fetchPromise);
  return fetchPromise;
}

export async function deleteStoragePaths(paths: string[]): Promise<void> {
  if (!paths || paths.length === 0) return;
  await Promise.all(
    paths.map(async (path) => {
      if (!path) return;
      if (path.startsWith('fsphoto:')) {
        const photoId = path.slice('fsphoto:'.length);
        photoDataUrlCache.delete(path);
        try {
          await deleteDoc(doc(db, 'orderPhotos', photoId));
        } catch (err) {
          console.warn('Could not delete orderPhoto doc:', photoId, err);
        }
        return;
      }
      try {
        await deleteObject(ref(storage, path));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes('storage/object-not-found')) {
          console.warn('Could not delete old storage image:', path, err);
        }
      }
    })
  );
}
