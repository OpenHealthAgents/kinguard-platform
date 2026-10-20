import React from 'react';
import { View, Image, Text, ViewProps } from 'react-native';

export function isUserUploadedImage(url?: string): boolean {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.includes('images.unsplash.com')) return false;
  if (trimmed.includes('lh3.googleusercontent.com/aida-public')) return false;
  return true;
}

export function getInitials(name?: string, fallback = 'KG'): string {
  if (!name || !name.trim()) return fallback;
  const clean = name.replace(/\s*\((coordinator|parent|caregiver)\)/i, '').replace(/Sync\s*\d+/i, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) {
    return parts[0].substring(0, Math.min(2, parts[0].length)).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AvatarProps extends ViewProps {
  url?: string;
  name?: string;
  initials?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  status?: 'online' | 'idle' | 'none';
  statusDotColor?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  url,
  name,
  initials,
  size = 'md',
  status = 'none',
  statusDotColor,
  className = '',
  ...props
}) => {
  let sizeClass = 'w-10 h-10';
  let textSizeClass = 'text-xs';
  let statusDotSize = 'w-2.5 h-2.5';

  if (size === 'sm') {
    sizeClass = 'w-8 h-8';
    textSizeClass = 'text-[10px]';
    statusDotSize = 'w-2 h-2';
  } else if (size === 'md') {
    sizeClass = 'w-10 h-10';
    textSizeClass = 'text-xs';
    statusDotSize = 'w-2.5 h-2.5';
  } else if (size === 'lg') {
    sizeClass = 'w-12 h-12';
    textSizeClass = 'text-sm';
    statusDotSize = 'w-3 h-3';
  } else if (size === 'xl') {
    sizeClass = 'w-14 h-14';
    textSizeClass = 'text-base';
    statusDotSize = 'w-3.5 h-3.5';
  }

  const resolvedInitials = initials || getInitials(name, 'KG');
  const hasValidUserImage = isUserUploadedImage(url);

  return (
    <View className={`relative shrink-0 ${sizeClass} ${className}`} {...props}>
      {hasValidUserImage ? (
        <Image
          source={{ uri: url }}
          className="w-full h-full rounded-full border border-neutral-100"
        />
      ) : (
        <View className="w-full h-full rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 items-center justify-center border-2 border-white shadow-xs">
          <Text className={`font-black text-white tracking-wider ${textSizeClass}`}>
            {resolvedInitials}
          </Text>
        </View>
      )}

      {status !== 'none' && (
        <View
          style={statusDotColor ? { backgroundColor: statusDotColor } : undefined}
          className={`absolute bottom-0 right-0 rounded-full border-2 border-white ${
            statusDotColor ? '' : (status === 'online' ? 'bg-[#34c759]' : 'bg-[#ff9500]')
          } ${statusDotSize}`}
        />
      )}
    </View>
  );
};
