import React, { createContext, useContext, useState } from 'react';

interface LayoutContextType {
  isMenuOpen: boolean;
  setIsMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  // Navegación global: TopNav se instancia dentro de cada pantalla (no una
  // sola vez en Layout), así que necesita esto por contexto para poder
  // llevar al botón de Configuración a la vista 'settings' sin tener que
  // pasar setCurrentView como prop a cada pantalla que renderiza TopNav.
  setCurrentView: (view: string) => void;
}

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export function LayoutProvider({
  children,
  setCurrentView,
}: {
  children: React.ReactNode;
  setCurrentView: (view: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(prev => !prev);

  return (
    <LayoutContext.Provider value={{ isMenuOpen, setIsMenuOpen, toggleMenu, setCurrentView }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (context === undefined) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}
