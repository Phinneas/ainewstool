/**
 * Logo Component for MCP servers
 * Displays server logos with fallback to gradient avatars
 */

import React from 'react';

interface LogoComponentProps {
  server: {
    id?: string;
    fields?: {
      name?: string;
      github_url?: string;
      homepage_url?: string;
      logoUrl?: string | null;
      logoSource?: string | null;
    };
  };
  size?: number;
  className?: string;
}

/**
 * Logo Component
 * Displays server logos with fallback to gradient avatars
 */
export const LogoComponent: React.FC<LogoComponentProps> = ({
  server,
  size = 48,
  className = '',
}) => {
  const logoUrl = server.fields?.logoUrl || null;
  const serverName = server.fields?.name || 'Unknown Server';

  // Handle image loading errors
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    e.currentTarget.style.display = 'none';
    const fallback = e.currentTarget.nextElementSibling;
    if (fallback) {
      (fallback as HTMLElement).style.display = 'flex';
    }
  };

  // Render logo image
  if (logoUrl) {
    return (
      <div className={`icon-wrapper ${className}`} style={{ width: size, height: size }}>
        <img
          src={logoUrl}
          alt={`${serverName} logo`}
          className="server-logo"
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            objectFit: 'cover',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: '2px solid rgba(255, 255, 255, 0.1)',
          }}
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          onError={handleImageError}
        />
        <div
          className="gradient-icon"
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            display: 'none',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            fontSize: size * 0.6,
            fontWeight: 'bold',
          }}
        >
          {serverName.charAt(0).toUpperCase()}
        </div>
      </div>
    );
  }

  // Render fallback gradient avatar
  return (
    <div
      className={`icon-wrapper gradient-icon ${className}`}
      role="img"
      aria-label={`${serverName} avatar`}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        fontSize: size * 0.6,
        fontWeight: 'bold',
      }}
    >
      {serverName.charAt(0).toUpperCase()}
    </div>
  );
};

export default LogoComponent;
