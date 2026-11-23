import { Shirt } from 'lucide-react';
import { useEffect, useState } from 'react';
import { resolvePhotoUrl } from '../services/storage';

interface OrderPhotoProps {
  src?: string;
  alt: string;
  className?: string;
  iconClassName?: string;
  onClick?: () => void;
  lazy?: boolean;
}

export function OrderPhoto({
  src,
  alt,
  className = 'w-full h-full object-cover',
  iconClassName = 'w-4 h-4 text-[#78716C]',
  onClick,
  lazy = true,
}: OrderPhotoProps) {
  const isFsPhoto = Boolean(src && src.startsWith('fsphoto:'));
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(() =>
    src && !isFsPhoto ? src : null
  );
  const [loading, setLoading] = useState(isFsPhoto);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);

    if (!src) {
      setResolvedUrl(null);
      setLoading(false);
      return;
    }

    if (!src.startsWith('fsphoto:')) {
      setResolvedUrl(src);
      setLoading(false);
      return;
    }

    setLoading(true);
    resolvePhotoUrl(src)
      .then((url) => {
        if (!cancelled) {
          setResolvedUrl(url);
          setLoading(false);
          if (!url) setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src || failed) {
    return <Shirt className={iconClassName} aria-hidden="true" />;
  }

  if (loading || !resolvedUrl) {
    return <div className="w-full h-full bg-[#ECE9E2] animate-pulse" aria-hidden="true" />;
  }

  return (
    <img
      src={resolvedUrl}
      alt={alt}
      loading={lazy ? 'lazy' : 'eager'}
      referrerPolicy="no-referrer"
      onClick={onClick}
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

export function useResolvedPhotoUrls(urls: string[]): string[] {
  const [resolved, setResolved] = useState<string[]>(() =>
    urls.map((u) => (u.startsWith('fsphoto:') ? '' : u))
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all(urls.map((u) => resolvePhotoUrl(u).then((res) => res || '')))
      .then((list) => {
        if (!cancelled) setResolved(list);
      })
      .catch(() => {
        // ignore individual resolution failures
      });
    return () => {
      cancelled = true;
    };
  }, [urls]);

  return resolved;
}
