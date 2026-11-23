import { useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';

interface FoodImageProps {
  src: string;
  alt: string;
  className?: string;
}

export default function FoodImage({ src, alt, className = '' }: FoodImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className={`aspect-[4/3] bg-background flex items-center justify-center rounded-[var(--radius-card)] ${className}`}>
        <UtensilsCrossed className="h-8 w-8 text-border" />
      </div>
    );
  }

  return (
    <div className={`aspect-[4/3] relative overflow-hidden bg-background rounded-[var(--radius-card)] ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 skeleton" aria-hidden="true" />
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}
