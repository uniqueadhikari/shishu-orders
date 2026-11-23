import { Camera, Expand, ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CompressedPhoto } from '../services/storage';
import { ImageLightbox } from './ImageLightbox';
import { OrderPhoto } from './OrderPhoto';

export interface PhotoItem {
  id: string;
  previewUrl: string;
  file?: File;
  compressed?: CompressedPhoto;
  compressing?: boolean;
  existingUrl?: string;
  existingPath?: string;
}

interface PhotoUploaderProps {
  items: PhotoItem[];
  onAddFiles: (files: File[]) => void;
  onRemoveItem: (id: string) => void;
  maxPhotos?: number;
}

export function PhotoUploader({
  items,
  onAddFiles,
  onRemoveItem,
  maxPhotos = 3,
}: PhotoUploaderProps) {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (items.length < maxPhotos && errorMsg) {
      setErrorMsg(null);
    }
  }, [items.length, maxPhotos, errorMsg]);

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const remainingSlots = maxPhotos - items.length;
    if (remainingSlots <= 0) {
      setErrorMsg(`Maximum ${maxPhotos} photos allowed per order.`);
      return;
    }

    const validImages: File[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (!f.type.startsWith('image/')) {
        setErrorMsg('Only image files are supported.');
        continue;
      }
      if (validImages.length < remainingSlots) {
        validImages.push(f);
      } else {
        setErrorMsg(`Only ${maxPhotos} photos max per order. Extra files were skipped.`);
      }
    }

    if (validImages.length > 0) {
      onAddFiles(validImages);
    }
  }

  const allUrls = items.map((item) => item.previewUrl);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[#5C5852]">
          Reference Photos ({items.length}/{maxPhotos} optional)
        </span>
      </div>

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {items.map((item, idx) => (
            <div
              key={item.id}
              className="group relative aspect-square rounded-xl overflow-hidden border border-[#E6E2D8] bg-[#F7F5F0]"
            >
              <OrderPhoto
                src={item.previewUrl}
                alt={`Product reference ${idx + 1}`}
                onClick={() => setLightboxIndex(idx)}
                className="w-full h-full object-cover cursor-pointer"
                lazy={false}
              />

              {item.compressing ? (
                <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center text-white text-[11px] font-medium gap-1">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Optimizing</span>
                </div>
              ) : (
                item.compressed && (
                  <span className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/65 text-white text-[10px] font-mono tabular-nums pointer-events-none">
                    {Math.max(1, Math.round(item.compressed.sizeBytes / 1024))} KB
                  </span>
                )
              )}

              <button
                type="button"
                onClick={() => setLightboxIndex(idx)}
                className="absolute bottom-2 left-2 min-h-[32px] min-w-[32px] px-2 rounded-lg bg-black/65 text-white text-xs flex items-center justify-center opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity cursor-pointer"
                aria-label="View full size photo"
              >
                <Expand className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => onRemoveItem(item.id)}
                className="absolute top-2 right-2 min-h-[32px] min-w-[32px] rounded-lg bg-black/70 hover:bg-rose-600 text-white flex items-center justify-center transition-colors cursor-pointer"
                aria-label="Remove photo"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length < maxPhotos && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => galleryInputRef.current?.click()}
            className="min-h-[48px] px-4 py-3 rounded-xl border border-dashed border-[#C9C3B6] bg-[#FAF9F5] hover:bg-[#EFECE5] text-sm font-medium text-[#121211] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ImagePlus className="w-4 h-4 text-[#5C5852]" />
            <span>{items.length === 0 ? 'Choose Photos' : 'Add Another Photo'}</span>
          </button>

          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="min-h-[48px] px-4 py-3 rounded-xl border border-[#DDD8CE] bg-white hover:bg-[#F7F5F0] text-sm font-medium text-[#121211] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <Camera className="w-4 h-4 text-[#5C5852]" />
            <span>Take Photo</span>
          </button>
        </div>
      )}

      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {errorMsg && (
        <p className="text-xs font-medium text-rose-700">{errorMsg}</p>
      )}

      {lightboxIndex !== null && (
        <ImageLightbox
          images={allUrls}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onSelectIndex={setLightboxIndex}
          title="Order Photo"
        />
      )}
    </div>
  );
}
