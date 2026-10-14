import React from 'react';
import { View, Text } from 'react-native';
import { Shield } from 'lucide-react-native';

export interface BrandLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'shield' | 'full' | 'image';
  showText?: boolean;
  className?: string;
  testID?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  variant: _variant = 'shield',
  showText = false,
  className = '',
  testID = 'brand-logo'
}) => {
  const sizeConfig = {
    sm: { container: 28, icon: 16, textClass: 'text-sm' },
    md: { container: 40, icon: 22, textClass: 'text-lg' },
    lg: { container: 56, icon: 30, textClass: 'text-2xl' },
    xl: { container: 72, icon: 38, textClass: 'text-3xl' },
  }[size] || { container: 40, icon: 22, textClass: 'text-lg' };

  return (
    <View
      testID={testID}
      accessible={true}
      accessibilityRole="image"
      accessibilityLabel="KinGuardian Brand Logo"
      className={`flex-row items-center gap-2.5 ${className}`}
    >
      <View
        style={{ width: sizeConfig.container, height: sizeConfig.container }}
        className="rounded-2xl bg-[#eff6ff] items-center justify-center border border-blue-100 shadow-xs shrink-0"
      >
        <Shield size={sizeConfig.icon} color="#007aff" fill="#eff6ff" />
      </View>
      {showText && (
        <Text className={`font-bold text-neutral-900 tracking-tight ${sizeConfig.textClass}`}>
          KinGuardian
        </Text>
      )}
    </View>
  );
};
