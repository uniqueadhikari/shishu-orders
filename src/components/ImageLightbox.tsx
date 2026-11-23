import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';
import { useResolvedPhotoUrls } from './OrderPhoto';

interface ImageLightboxProps {
  images: string[];
  initialIndex: number;
  onClose: () => void;
  onSelectIndex: (idx: number) => void;
  title?: string;
}

export function ImageLightbox({
  images,
  initialIndex,
  onClose,
  onSelectIndex,
  title,
}: ImageLightboxProps) {
  const resolvedImages = useResolvedPhotoUrls(images);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && images.length > 1) {
        onSelectIndex((initialIndex + 1) % images.length);
      }
      if (e.key === 'ArrowLeft' && images.length > 1) {
        onSelectIndex((initialIndex - 1 + images.length) % images.length);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [images.length, initialIndex, onClose, onSelectIndex]);

  if (images.length === 0) return null;
  const current = resolvedImages[initialIndex] ?? resolvedImages[0] ?? '';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex flex-col items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Product reference photo preview"
    >
      <div
        className="w-full max-w-4xl flex items-center justify-between text-white pb-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium truncate pr-4">
          {title ? `${title} · ` : ''}Photo {initialIndex + 1} of {images.length}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
          aria-label="Close full-size image"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div
        className="relative w-full max-w-4xl flex items-center justify-center min-h-[240px]"
        onClick={(e) => e.stopPropagation()}
      >
        {images.length > 1 && (
          <button
            type="button"
            onClick={() => onSelectIndex((initialIndex - 1 + images.length) % images.length)}
            className="absolute left-2 sm:left-4 z-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors cursor-pointer"
            aria-label="Previous photo"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {current ? (
          <img
            src={current}
            alt={title || 'Order product reference'}
            referrerPolicy="no-referrer"
            className="max-h-[78vh] max-w-full object-contain rounded-xl bg-black/40"
          />
        ) : (
          <div className="w-72 h-72 rounded-xl bg-white/10 animate-pulse" />
        )}

        {images.length > 1 && (
          <button
            type="button"
            onClick={() => onSelectIndex((initialIndex + 1) % images.length)}
            className="absolute right-2 sm:right-4 z-10 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors cursor-pointer"
            aria-label="Next photo"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {images.length > 1 && (
        <div
          className="flex items-center gap-2 mt-4"
          onClick={(e) => e.stopPropagation()}
        >
          {resolvedImages.map((src, idx) => (
            <button
              key={`${images[idx]}-${idx}`}
              type="button"
              onClick={() => onSelectIndex(idx)}
              className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all cursor-pointer bg-white/10 ${
                idx === initialIndex ? 'border-white scale-105' : 'border-transparent opacity-60 hover:opacity-100'
              }`}
            >
              {src && (
                <img
                  src={src}
                  alt={`Thumbnail ${idx + 1}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
