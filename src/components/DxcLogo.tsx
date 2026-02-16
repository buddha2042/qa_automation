'use client';

import Image from 'next/image';

interface DxcLogoProps {
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
}

export default function DxcLogo({
  width = 72,
  height = 20,
  className,
  priority = false,
}: DxcLogoProps) {
  return (
    <Image
      src="/dxc-logo-png-4x.png"
      alt="DXC logo"
      width={width}
      height={height}
      priority={priority}
      className={className}
    />
  );
}
