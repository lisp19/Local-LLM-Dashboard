'use client';
import React from 'react';
import { ConfigProvider, theme } from 'antd';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff', // Standard Antd Blue
          colorSuccess: '#52c41a', 
          colorError: '#ff4d4f',
          borderRadius: 16,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
        },
        components: {
          Card: {
            borderRadiusLG: 24,
            paddingLG: 24,
          },
          Descriptions: {
            // Colors will inherit default light theme
          }
        }
      }}
    >
      {children}
    </ConfigProvider>
  );
}
