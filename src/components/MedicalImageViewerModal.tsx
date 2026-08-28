"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  X as XIcon,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  Activity,
  Maximize2,
  Minimize2,
  Info
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MedicalImageItem {
  src: string;
  caption?: string;
  alt?: string;
}

interface MedicalImageViewerModalProps {
  isOpen: boolean;
  image: MedicalImageItem | null;
  onClose: () => void;
}

export function MedicalImageViewerModal({
  isOpen,
  image,
  onClose
}: MedicalImageViewerModalProps) {
  const [zoom, setZoom] = useState<number>(1);
  const [isFullDesktop, setIsFullDesktop] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Reset zoom on open or image change
  useEffect(() => {
    if (isOpen) {
      setZoom(1);
      setDragOffset({ x: 0, y: 0 });
      setIsDragging(false);
    }
  }, [isOpen, image?.src]);

  // Keyboard shortcut handler (Escape, +, -, 0)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "+" || e.key === "=") {
        setZoom(prev => Math.min(3, +(prev + 0.25).toFixed(2)));
      } else if (e.key === "-" || e.key === "_") {
        setZoom(prev => Math.max(0.5, +(prev - 0.25).toFixed(2)));
      } else if (e.key === "0") {
        setZoom(1);
        setDragOffset({ x: 0, y: 0 });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background body scroll when open
  useEffect(() => {
    if (isOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isOpen]);

  const handleZoomIn = () => setZoom(prev => Math.min(3, +(prev + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom(prev => Math.max(0.5, +(prev - 0.25).toFixed(2)));
  const handleResetZoom = () => {
    setZoom(1);
    setDragOffset({ x: 0, y: 0 });
  };

  const handleToggleZoom = () => {
    if (zoom === 1) {
      setZoom(1.75);
    } else {
      setZoom(1);
      setDragOffset({ x: 0, y: 0 });
    }
  };

  // Mouse pan handling when zoomed
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y };
    }
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setDragOffset({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  }, [isDragging, zoom]);

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  if (!isOpen || !image || !image.src) return null;

  const displayCaption = image.caption || (image.alt && image.alt !== "Imagerie médicale" ? image.alt : null);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 sm:bg-black/80 sm:backdrop-blur-md transition-all duration-200"
      onClick={onClose}
      onMouseUp={handleMouseUp}
    >
      {/* Container : iPhone (Full Screen Edge-to-Edge) vs Desktop (Fenêtre Épurée & Sobre) */}
      <div
        className={`w-full h-full sm:h-auto ${
          isFullDesktop
            ? "sm:w-full sm:h-full sm:max-w-none sm:rounded-none"
            : "sm:max-w-5xl sm:h-[90vh] sm:rounded-2xl"
        } bg-[#121110] text-[#FAF7F2] border-0 sm:border sm:border-[#2D2825] shadow-2xl flex flex-col overflow-hidden relative transition-all duration-300`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* TOP BAR / HEADER */}
        <header className="w-full flex items-center justify-between px-3 sm:px-5 py-2.5 sm:py-3.5 border-b border-[#26221F] bg-[#181615]/95 backdrop-blur-md z-30 shrink-0 pt-[max(env(safe-area-inset-top),10px)] sm:pt-3">
          {/* Badge & Titre Sober */}
          <div className="flex items-center gap-2.5 min-w-0 pr-2">
            <div className="w-7 h-7 rounded-lg bg-[#bd613c]/15 text-[#bd613c] flex items-center justify-center shrink-0 border border-[#bd613c]/30">
              <Activity className="w-4 h-4" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs sm:text-sm font-semibold tracking-tight text-stone-100 truncate">
                Visualisation Imagerie HD
              </span>
              <span className="text-[10px] text-stone-400 font-mono hidden sm:inline truncate">
                Radio • Scanner • IRM • Schéma didactique
              </span>
            </div>
          </div>

          {/* Controls Toolbar (Zoom + Actions) */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Zoom controls */}
            <div className="flex items-center bg-[#231F1C] border border-[#332D28] rounded-xl p-0.5 sm:p-1 shadow-inner">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg"
                onClick={handleZoomOut}
                title="Zoom arrière (-)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>

              <button
                onClick={handleResetZoom}
                className="px-2 py-0.5 text-[11px] sm:text-xs font-mono font-medium text-stone-300 hover:text-[#bd613c] transition-colors rounded"
                title="Cliquer pour réinitialiser à 100%"
              >
                {Math.round(zoom * 100)}%
              </button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg"
                onClick={handleZoomIn}
                title="Zoom avant (+)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-stone-400 hover:text-white hover:bg-white/10 rounded-lg hidden sm:flex"
                onClick={handleResetZoom}
                title="Réinitialiser zoom (100%)"
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </div>

            {/* Desktop Fullscreen Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-stone-400 hover:text-white hover:bg-[#231F1C] rounded-xl hidden sm:flex"
              onClick={() => setIsFullDesktop(prev => !prev)}
              title={isFullDesktop ? "Réduire la fenêtre" : "Agrandir en plein écran"}
            >
              {isFullDesktop ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>

            {/* Open in external tab */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[#bd613c] hover:text-[#bd613c] hover:bg-[#bd613c]/15 rounded-xl"
              onClick={() => window.open(image.src, "_blank")}
              title="Ouvrir l'image originale HD dans un nouvel onglet"
            >
              <ExternalLink className="w-4 h-4" />
            </Button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="h-8 w-8 rounded-full bg-stone-800/80 hover:bg-[#bd613c] text-stone-300 hover:text-white flex items-center justify-center transition-all shadow-md active:scale-95 ml-1 border border-stone-700/50"
              title="Fermer (Échap)"
              aria-label="Fermer"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* MAIN IMAGE VIEWING AREA */}
        <main
          className="flex-1 w-full relative overflow-hidden flex items-center justify-center bg-[#0C0B0A] select-none p-2 sm:p-6 cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
        >
          <div
            className="w-full h-full flex items-center justify-center transition-transform duration-150 ease-out"
            style={{
              transform: `scale(${zoom}) translate(${dragOffset.x / zoom}px, ${dragOffset.y / zoom}px)`,
              transformOrigin: "center center"
            }}
          >
            <img
              src={image.src}
              alt={image.alt || "Radio / IRM HD"}
              className="max-w-full max-h-full object-contain rounded-md sm:rounded-xl shadow-2xl pointer-events-auto transition-all"
              onClick={handleToggleZoom}
              title="Double-cliquez ou touchez pour basculer le zoom (175% / 100%)"
              draggable={false}
            />
          </div>

          {/* Discreet Zoom indicator badge on mobile */}
          {zoom > 1 && (
            <div className="absolute top-4 left-4 sm:hidden bg-black/75 backdrop-blur-md text-[#FAF7F2] text-[10px] font-mono px-2.5 py-1 rounded-full border border-white/10 pointer-events-none">
              Zoom: {Math.round(zoom * 100)}%
            </div>
          )}
        </main>

        {/* FOOTER / LEGENDE & EXPLICATIONS SOBRES */}
        <footer className="w-full bg-[#181615]/95 border-t border-[#26221F] px-4 py-3 sm:py-3.5 z-30 shrink-0 pb-[max(env(safe-area-inset-bottom),12px)] sm:pb-3.5">
          <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
            {displayCaption ? (
              <div className="flex items-start gap-2 max-w-full">
                <Info className="w-4 h-4 text-[#bd613c] shrink-0 mt-0.5 hidden sm:inline" />
                <p className="text-xs sm:text-sm text-stone-200 font-medium leading-relaxed">
                  {displayCaption}
                </p>
              </div>
            ) : (
              <p className="text-xs text-stone-400 italic">
                Cliché radiologique haute résolution
              </p>
            )}

            {/* Desktop hints */}
            <div className="hidden lg:flex items-center gap-3 text-[11px] text-stone-400 font-mono shrink-0">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-[#231F1C] border border-[#332D28] rounded text-[10px] text-stone-300">Échap</kbd> Fermer
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-[#231F1C] border border-[#332D28] rounded text-[10px] text-stone-300">+</kbd>
                <kbd className="px-1.5 py-0.5 bg-[#231F1C] border border-[#332D28] rounded text-[10px] text-stone-300">-</kbd> Zoom
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 bg-[#231F1C] border border-[#332D28] rounded text-[10px] text-stone-300">Clic</kbd> Basculer
              </span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
