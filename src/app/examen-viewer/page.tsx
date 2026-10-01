"use client";

import React, { Suspense, useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Maximize2,
  Minimize2,
  ExternalLink,
  X as XIcon,
  Contrast,
  Activity,
  FileText,
  Download,
  Info,
  Layers
} from "lucide-react";
import { Button } from "@/components/ui/button";

function ExamenViewerContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const url = searchParams.get("url") || "";
  const title = searchParams.get("title") || "Examen complémentaire";
  const consultationId = searchParams.get("consultationId") || "";
  const patientName = searchParams.get("patientName") || "";
  const explicitType = searchParams.get("type");

  const isPDF =
    explicitType === "pdf" ||
    url.toLowerCase().endsWith(".pdf") ||
    url.toLowerCase().includes(".pdf");

  // Visual & Zoom States
  const [zoom, setZoom] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [isInverted, setIsInverted] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [showLegend, setShowLegend] = useState<boolean>(true);

  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialTouchDistanceRef = useRef<number | null>(null);
  const initialZoomRef = useRef<number>(1);

  // Return to Consultation Bilan
  const handleReturnToBilan = useCallback(() => {
    // 1. Essayer d'abord de fermer la fenêtre/onglet (si ouvert via window.open ou target="_blank")
    try {
      if (typeof window !== "undefined") {
        window.close();
      }
    } catch (err) {
      console.log("window.close() non autorisé par le navigateur:", err);
    }

    // 2. Si l'onglet ne se ferme pas automatiquement (sécurité navigateur), naviguer vers la consultation
    setTimeout(() => {
      if (consultationId) {
        router.push(`/consultation/${consultationId}`);
      } else {
        router.back();
      }
    }, 150);
  }, [consultationId, router]);

  // Keyboard Shortcuts (Échap pour sortir, +, -, 0, r, i)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleReturnToBilan();
      } else if (e.key === "+" || e.key === "=") {
        setZoom((prev) => Math.min(4, +(prev + 0.25).toFixed(2)));
      } else if (e.key === "-" || e.key === "_") {
        setZoom((prev) => Math.max(0.5, +(prev - 0.25).toFixed(2)));
      } else if (e.key === "0") {
        setZoom(1);
        setDragOffset({ x: 0, y: 0 });
        setRotation(0);
      } else if (e.key.toLowerCase() === "r") {
        setRotation((prev) => (prev + 90) % 360);
      } else if (e.key.toLowerCase() === "i") {
        setIsInverted((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleReturnToBilan]);

  // Sync fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleZoomIn = () => setZoom((prev) => Math.min(4, +(prev + 0.25).toFixed(2)));
  const handleZoomOut = () => setZoom((prev) => Math.max(0.5, +(prev - 0.25).toFixed(2)));
  const handleReset = () => {
    setZoom(1);
    setDragOffset({ x: 0, y: 0 });
    setRotation(0);
  };
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleToggleInvert = () => setIsInverted((prev) => !prev);

  const handleToggleZoomClick = () => {
    if (zoom === 1) {
      setZoom(2);
    } else {
      setZoom(1);
      setDragOffset({ x: 0, y: 0 });
    }
  };

  // Mouse drag handling
  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.clientX - dragOffset.x,
        y: e.clientY - dragOffset.y
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setDragOffset({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch handlers for mobile (pinch-to-zoom & pan)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      initialTouchDistanceRef.current = Math.sqrt(dx * dx + dy * dy);
      initialZoomRef.current = zoom;
    } else if (e.touches.length === 1 && zoom > 1) {
      setIsDragging(true);
      dragStartRef.current = {
        x: e.touches[0].clientX - dragOffset.x,
        y: e.touches[0].clientY - dragOffset.y
      };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && initialTouchDistanceRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);
      const factor = currentDistance / initialTouchDistanceRef.current;
      const newZoom = Math.min(4, Math.max(0.6, +(initialZoomRef.current * factor).toFixed(2)));
      setZoom(newZoom);
    } else if (e.touches.length === 1 && isDragging && zoom > 1) {
      setDragOffset({
        x: e.touches[0].clientX - dragStartRef.current.x,
        y: e.touches[0].clientY - dragStartRef.current.y
      });
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    initialTouchDistanceRef.current = null;
  };

  // Wheel zoom handling
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 20) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.2 : -0.2;
      setZoom((prev) => Math.min(4, Math.max(0.5, +(prev + delta).toFixed(2))));
    }
  };

  if (!url) {
    return (
      <div className="min-h-screen bg-[#100e0d] text-stone-200 flex flex-col items-center justify-center p-6 text-center">
        <Activity className="w-12 h-12 text-[#bd613c] mb-4 animate-pulse" />
        <h1 className="text-xl font-semibold mb-2">Aucun document spécifié</h1>
        <p className="text-sm text-stone-400 mb-6 max-w-md">
          L&apos;adresse de l&apos;imagerie ou du rapport médical n&apos;a pas pu être chargée.
        </p>
        <Button
          onClick={handleReturnToBilan}
          className="bg-[#bd613c] hover:bg-[#a35232] text-white gap-2 rounded-xl"
        >
          <ArrowLeft className="w-4 h-4" /> Revenir au bilan
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 w-screen h-screen bg-[#0d0c0b] text-[#FAF7F2] flex flex-col overflow-hidden select-none">
      {/* =========================================================================
          TOP BAR : NAVIGATION & COMMANDES CLINIQUES
          ========================================================================= */}
      <header className="w-full flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3 border-b border-[#25211e] bg-[#161413]/95 backdrop-blur-md z-40 shrink-0 pt-[max(env(safe-area-inset-top),10px)]">
        {/* BOUTON MAÎTRE : REVENIR AU BILAN (HAUTE VISIBILITÉ) */}
        <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={handleReturnToBilan}
            className="flex items-center gap-2 bg-[#bd613c] hover:bg-[#a55130] text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl font-semibold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all active:scale-95 shrink-0 border border-[#d8734c]/40 cursor-pointer"
            title="Revenir au bilan de consultation (ou fermer cette fenêtre)"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="font-sans">Revenir au bilan</span>
          </button>

          {/* TITRE ET INFORMATIONS PATIENT */}
          <div className="flex flex-col min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-semibold tracking-tight text-stone-100 truncate">
                {title}
              </span>
              <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#bd613c]/20 text-[#e4835e] border border-[#bd613c]/30">
                {isPDF ? "Rapport PDF" : "Radio / IRM HD"}
              </span>
            </div>
            {patientName && (
              <span className="text-[10px] sm:text-xs text-stone-400 font-sans truncate">
                Dossier patient : <strong className="text-stone-300 font-medium">{patientName}</strong>
              </span>
            )}
          </div>
        </div>

        {/* OUTILS DE MANIPULATION & ZOOM (DESKTOP & TABLETTE) */}
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {!isPDF && (
            <>
              {/* Barre de Zoom */}
              <div className="flex items-center bg-[#211d1a] border border-[#332c27] rounded-xl p-0.5 sm:p-1 shadow-inner">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg"
                  onClick={handleZoomOut}
                  title="Zoom arrière (-)"
                >
                  <ZoomOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>

                <button
                  onClick={handleReset}
                  className="px-1.5 sm:px-2.5 py-0.5 text-[11px] sm:text-xs font-mono font-medium text-stone-300 hover:text-[#bd613c] transition-colors rounded"
                  title="Cliquer pour réinitialiser à 100%"
                >
                  {Math.round(zoom * 100)}%
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 text-stone-300 hover:text-white hover:bg-white/10 rounded-lg"
                  onClick={handleZoomIn}
                  title="Zoom avant (+)"
                >
                  <ZoomIn className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 sm:h-8 sm:w-8 text-stone-400 hover:text-white hover:bg-white/10 rounded-lg hidden sm:flex"
                  onClick={handleReset}
                  title="Réinitialiser zoom & cadrage (0)"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Rotation 90° */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-stone-300 hover:text-white hover:bg-[#211d1a] rounded-xl border border-transparent hover:border-[#332c27] hidden sm:flex"
                onClick={handleRotate}
                title="Pivoter de 90° (R)"
              >
                <RotateCw className="w-4 h-4" />
              </Button>

              {/* Inversion PACS / Contraste Osseux */}
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 rounded-xl border transition-colors hidden sm:flex ${
                  isInverted
                    ? "bg-[#bd613c]/20 text-[#e4835e] border-[#bd613c]"
                    : "text-stone-300 hover:text-white hover:bg-[#211d1a] border-transparent hover:border-[#332c27]"
                }`}
                onClick={handleToggleInvert}
                title="Mode négatif / contraste PACS pour lecture radiologique fine (I)"
              >
                <Contrast className="w-4 h-4" />
              </Button>
            </>
          )}

          {/* Plein écran natif */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-stone-300 hover:text-white hover:bg-[#211d1a] rounded-xl border border-transparent hover:border-[#332c27] hidden sm:flex"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Quitter le plein écran" : "Plein écran (F)"}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>

          {/* Ouvrir le fichier brut dans un autre onglet */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-stone-300 hover:text-[#bd613c] hover:bg-[#bd613c]/15 rounded-xl border border-transparent hover:border-[#bd613c]/30"
            onClick={() => window.open(url, "_blank")}
            title="Ouvrir le fichier original dans un nouvel onglet"
          >
            <ExternalLink className="w-4 h-4" />
          </Button>

          {/* Bouton Fermer (Croix d'appoint) */}
          <button
            type="button"
            onClick={handleReturnToBilan}
            className="h-8 w-8 rounded-full bg-stone-800/80 hover:bg-[#bd613c] text-stone-300 hover:text-white flex items-center justify-center transition-all shadow-md active:scale-95 ml-1 border border-stone-700/50 cursor-pointer"
            title="Fermer la fenêtre (Échap)"
            aria-label="Fermer"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* =========================================================================
          ZONE PRINCIPALE D'AFFICHAGE (IMAGE RADIOLOGIQUE OU PDF)
          ========================================================================= */}
      <main
        className="flex-1 w-full h-full relative overflow-hidden bg-[#090807] flex items-center justify-center"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onWheel={handleWheel}
      >
        {isPDF ? (
          /* LECTEUR PDF INTÉGRÉ PLEINE PAGE */
          <div className="w-full h-full flex flex-col bg-white">
            <iframe
              src={url}
              title={title}
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          /* VISIONNEUSE RADIOLOGIQUE INTERACTIVE (PAN & ZOOM HD) */
          <div
            className={`w-full h-full flex items-center justify-center p-2 sm:p-6 select-none ${
              zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
            }`}
          >
            <div
              className="w-full h-full flex items-center justify-center transition-transform duration-100 ease-out will-change-transform"
              style={{
                transform: `scale(${zoom}) translate(${dragOffset.x / zoom}px, ${
                  dragOffset.y / zoom
                }px) rotate(${rotation}deg)`,
                transformOrigin: "center center"
              }}
            >
              <img
                src={url}
                alt={title}
                className="max-w-full max-h-full object-contain rounded-md sm:rounded-xl shadow-2xl transition-all duration-200 pointer-events-auto"
                style={{
                  filter: isInverted
                    ? "invert(1) hue-rotate(180deg) contrast(1.2)"
                    : "none"
                }}
                onClick={handleToggleZoomClick}
                title="Double-cliquez pour basculer le zoom (100% / 200%) ou glissez pour déplacer"
                draggable={false}
              />
            </div>
          </div>
        )}

        {/* INDICATEUR DE ZOOM FLOTTANT SUR SMARTPHONE */}
        {!isPDF && zoom > 1 && (
          <div className="absolute top-4 left-4 sm:hidden bg-black/80 backdrop-blur-md text-[#FAF7F2] text-[11px] font-mono px-3 py-1 rounded-full border border-white/10 pointer-events-none shadow-lg">
            Zoom : {Math.round(zoom * 100)}%
          </div>
        )}
      </main>

      {/* =========================================================================
          PIED DE PAGE : LÉGENDE CLINIQUE & BOUTON FLOTTANT MOBILE
          ========================================================================= */}
      <footer className="w-full bg-[#161413]/95 border-t border-[#25211e] px-4 py-2.5 sm:py-3 z-30 shrink-0 pb-[max(env(safe-area-inset-bottom),10px)]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-center sm:text-left">
          {/* Repères didactiques TDT */}
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-[11px] sm:text-xs text-stone-300">
            <span className="font-semibold text-stone-400">Repères didactiques TDT :</span>
            <span className="inline-flex items-center gap-1 bg-[#AF2D14]/15 text-[#e06b54] px-2 py-0.5 rounded-full border border-[#AF2D14]/30">
              🔴 Foyer algogène
            </span>
            <span className="inline-flex items-center gap-1 bg-[#236E41]/15 text-[#62c086] px-2 py-0.5 rounded-full border border-[#236E41]/30">
              🟢 Structure saine
            </span>
            <span className="inline-flex items-center gap-1 bg-[#1A535C]/20 text-[#5dbbc9] px-2 py-0.5 rounded-full border border-[#1A535C]/40">
              🔵 Repère cardinal
            </span>
            <span className="inline-flex items-center gap-1 bg-[#BD613C]/15 text-[#e49b7d] px-2 py-0.5 rounded-full border border-[#BD613C]/30">
              🟠 Remaniement chronique
            </span>
          </div>

          {/* Raccourcis clavier desktop */}
          <div className="hidden lg:flex items-center gap-3 text-[11px] text-stone-400 font-mono shrink-0">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-[#211d1a] border border-[#332c27] rounded text-[10px] text-stone-300">Échap</kbd> Revenir au bilan
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-[#211d1a] border border-[#332c27] rounded text-[10px] text-stone-300">+</kbd>
              <kbd className="px-1.5 py-0.5 bg-[#211d1a] border border-[#332c27] rounded text-[10px] text-stone-300">-</kbd> Zoom
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-[#211d1a] border border-[#332c27] rounded text-[10px] text-stone-300">R</kbd> Pivoter
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-[#211d1a] border border-[#332c27] rounded text-[10px] text-stone-300">I</kbd> Négatif
            </span>
          </div>
        </div>
      </footer>

      {/* BOUTON FLOTTANT GÉANT POUR IPHONE & PETITS ÉCRANS (POUR NE JAMAIS ÊTRE BLOQUÉ) */}
      <div className="fixed bottom-14 left-1/2 -translate-x-1/2 z-50 sm:hidden pointer-events-auto">
        <button
          type="button"
          onClick={handleReturnToBilan}
          className="flex items-center gap-2 bg-[#bd613c] active:bg-[#9e4324] text-white px-5 py-2.5 rounded-full font-bold text-sm shadow-2xl border-2 border-white/20 active:scale-95 transition-all backdrop-blur-md cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 stroke-[2.5]" />
          <span>Revenir au bilan</span>
        </button>
      </div>
    </div>
  );
}

export default function ExamenViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#100e0d] text-stone-200 flex flex-col items-center justify-center p-6 text-center">
          <Activity className="w-10 h-10 text-[#bd613c] animate-spin mb-4" />
          <p className="text-sm font-medium text-stone-300">
            Chargement de l&apos;examen en haute résolution...
          </p>
        </div>
      }
    >
      <ExamenViewerContent />
    </Suspense>
  );
}
