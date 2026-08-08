import React from 'react';
import { Sidebar } from './Sidebar';
import { useLayout } from '../contexts/LayoutContext';

interface LayoutProps {
  children: React.ReactNode;
  currentView: string;
  setCurrentView: (view: string) => void;
}

export function Layout({ children, currentView, setCurrentView }: LayoutProps) {
  const { isMenuOpen, setIsMenuOpen } = useLayout();

  return (
    <div className="flex min-h-screen bg-surface-container-low">
      <Sidebar 
        currentView={currentView} 
        setCurrentView={setCurrentView} 
        isOpen={isMenuOpen} 
        onClose={() => setIsMenuOpen(false)}
      />
      <div className="flex-1 md:ml-64 flex flex-col relative w-full overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
