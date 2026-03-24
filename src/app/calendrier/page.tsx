"use client";

import { useEffect, useState } from "react";
import { supabase, SupabaseConsultation } from "@/lib/supabaseClient";
import { format, startOfWeek, addDays, subWeeks, addWeeks, isSameDay } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, CalendarDays, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// Représente un événement dans le calendrier
interface CalendarEvent {
    id: string;
    consultationId: string;
    title: string;
    type: 'bilan' | 'suivi';
    date: Date;
    hour: number;
    sessionNumber?: number;
    dayStr?: string;
}

export default function CalendarPage() {
    const router = useRouter();
    const [consultations, setConsultations] = useState<SupabaseConsultation[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [mobileView, setMobileView] = useState<'liste' | 'semaine'>('liste'); // Par défaut Liste sur mobile

    useEffect(() => {
        async function fetchConsultations() {
            const { data, error } = await supabase
                .from('consultations')
                .select('*')
                .order('date', { ascending: false });

            if (error) {
                console.error("Erreur chargement consultations :", error);
            } else {
                setConsultations(data || []);
            }
            setLoading(false);
        }
        fetchConsultations();
    }, []);

    const extractExplicitSession = (text: string | null | undefined): number | null => {
        if (!text) return null;
        const match = text.match(/\b(?:s|séance|seance)\s*([0-9]+)\b/i);
        if (match) {
            const num = parseInt(match[1], 10);
            const isSpelledOut = /(?:séance|seance)/i.test(match[0]);
            if (num >= 1900 && num <= 2100 && !isSpelledOut) return null;
            if (num > 5 || isSpelledOut) return num;
        }
        return null;
    };

    // Générer tous les événements (un par jour unique par patient)
    const events: CalendarEvent[] = [];
    consultations.forEach(c => {
        // 1. Collecter toutes les interactions (bilan + suivis)
        const interactions: { date: Date, type: 'bilan' | 'suivi' }[] = [];
        const allDates = new Set<string>();

        if (c.date) {
            try {
                const d = new Date(c.date);
                if (!isNaN(d.getTime())) {
                    interactions.push({ date: d, type: 'bilan' });
                    allDates.add(d.toISOString().split('T')[0]);
                }
            } catch (err) { }
        }

        if (c.follow_ups && Array.isArray(c.follow_ups)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.follow_ups.forEach((f: any) => {
                if (f.date || f.created_at) {
                    try {
                        const d = new Date(f.date || f.created_at);
                        if (!isNaN(d.getTime())) {
                            if (f.type !== 'session_override') {
                                interactions.push({ date: d, type: 'suivi' });
                            }
                            allDates.add(d.toISOString().split('T')[0]);
                        }
                    } catch (err) { }
                }
            });
        }

        const sortedAllDates = Array.from(allDates).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());

        let maxExplicitOffset = 0;
        let maxExplicitIndex = -1;

        if (c.date) {
            const num = extractExplicitSession(c.resume) || extractExplicitSession(c.synthese);
            if (num) {
                maxExplicitOffset = num;
                maxExplicitIndex = 0;
            }
        }

        if (c.follow_ups && Array.isArray(c.follow_ups)) {
            c.follow_ups.forEach((note: any) => {
                const dateVal = note.date || note.created_at;
                if (dateVal) {
                    try {
                        const dTest = new Date(dateVal);
                        if (!isNaN(dTest.getTime())) {
                            const dStr = dTest.toISOString().split('T')[0];
                            const dIdx = sortedAllDates.indexOf(dStr);
                            let num = null;
                            if (note.type === 'session_override') {
                                num = note.value;
                            } else {
                                num = extractExplicitSession(note.title) || extractExplicitSession(note.content);
                            }
                            if (num && num > maxExplicitOffset) {
                                maxExplicitOffset = num;
                                maxExplicitIndex = dIdx;
                            }
                        }
                    } catch (err) { }
                }
            });
        }

        const getSessionNumberForDay = (dayStr: string) => {
            const idx = sortedAllDates.indexOf(dayStr);
            if (maxExplicitOffset > 0 && maxExplicitIndex >= 0) {
                return maxExplicitOffset + (idx - maxExplicitIndex);
            }
            return idx + 1;
        };

        // 2. Grouper par jour (YYYY-MM-DD)
        const groupedByDay: Record<string, { date: Date, type: 'bilan' | 'suivi' }[]> = {};
        interactions.forEach(int => {
            try {
                if (!isNaN(int.date.getTime())) {
                    const dayStr = int.date.toISOString().split('T')[0];
                    if (!groupedByDay[dayStr]) groupedByDay[dayStr] = [];
                    groupedByDay[dayStr].push(int);
                }
            } catch (err) { }
        });

        // 3. Créer un seul événement par jour avec l'heure la plus ancienne
        Object.entries(groupedByDay).forEach(([dayStr, ints]) => {
            const isBilan = ints.some(i => i.type === 'bilan');
            const earliestDate = new Date(Math.min(...ints.map(i => i.date.getTime())));

            events.push({
                id: `${isBilan ? 'bilan' : 'suivi'}-${c.id}-${dayStr}`,
                consultationId: c.id,
                title: c.patient_name || c.patientName || `Patient #${c.id}`,
                type: isBilan ? 'bilan' : 'suivi',
                date: earliestDate,
                hour: earliestDate.getHours(), // use local hour
                sessionNumber: getSessionNumberForDay(dayStr),
                dayStr: dayStr
            });
        });
    });

    const handleDropEvent = async (eventData: any, targetDay: Date, targetHour: number) => {
        try {
            const minutes = (targetHour >= 9 && targetHour <= 12) ? 15 : 0;
            const newDate = new Date(targetDay);
            newDate.setHours(targetHour, minutes, 0, 0);

            const consultation = consultations.find(c => c.id === eventData.consultationId);
            if (!consultation) return;

            // Optimistic UI update could be added here, but fetching is safer
            setLoading(true);

            if (eventData.type === 'bilan') {
                await supabase.from('consultations').update({ date: newDate.toISOString() }).eq('id', consultation.id);
            } else {
                const targetDayStr = eventData.dayStr;
                const updatedFollowUps = consultation.follow_ups?.map((f: any) => {
                    const fDate = f.date || f.created_at;
                    if (fDate && new Date(fDate).toISOString().split('T')[0] === targetDayStr) {
                        return { ...f, date: newDate.toISOString() };
                    }
                    return f;
                });
                await supabase.from('consultations').update({ follow_ups: updatedFollowUps }).eq('id', consultation.id);
            }

            const { data, error } = await supabase.from('consultations').select('*').order('date', { ascending: false });
            if (!error && data) {
                setConsultations(data);
            }
            setLoading(false);
        } catch (e) {
            console.error("Erreur l'ors du déplacement du rendez-vous", e);
            setLoading(false);
        }
    };

    const nextWeek = () => setCurrentWeekStart(addWeeks(currentWeekStart, 1));
    const prevWeek = () => setCurrentWeekStart(subWeeks(currentWeekStart, 1));
    const goToday = () => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

    // Afficher de Lundi (0) à Samedi (5)
    const weekDays = Array.from({ length: 6 }).map((_, i) => addDays(currentWeekStart, i));

    // Plages horaires personnalisées : le matin à partir de 9h15 jusqu'à 13h15 (donc slots 9->12), 
    // et l'après-midi fin à 20h.
    const TIME_SLOTS = [
        { id: 9, label: "09h15" },
        { id: 10, label: "10h15" },
        { id: 11, label: "11h15" },
        { id: 12, label: "12h15" },
        { id: 13, label: "13h00" }, // Gardé au cas où une interaction tombe sur 13h
        { id: 14, label: "14h00" },
        { id: 15, label: "15h00" },
        { id: 16, label: "16h00" },
        { id: 17, label: "17h00" },
        { id: 18, label: "18h00" },
        { id: 19, label: "19h00" } // Fini à 20h
    ];

    return (
        <div className="min-h-screen bg-[#fdfcfb]">
            {/* Top Bar Complète (copie exacte de la home top bar) */}
            <header className="sticky top-0 z-50 w-full bg-[#fdfcfb]/80 backdrop-blur-md border-b border-[#ebd9c8]/50 shadow-sm print:hidden">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    {/* Section Gauche : Logo et Bouton Retour */}
                    <div className="flex items-center gap-4">
                        <Link href="/" className="flex items-center gap-2 group">
                            <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-[#bd613c] flex items-center justify-center shrink-0 transition-transform group-hover:scale-105 shadow-inner">
                                <span className="font-bebas text-white text-base md:text-xl tracking-wider">TDT</span>
                            </div>
                            <div className="flex flex-col">
                                <span className="font-bebas tracking-wide text-xl md:text-2xl text-[#bd613c] leading-none uppercase">Techniques Douces Tissulaires</span>
                                <span className="text-[10px] md:text-xs text-[#bd613c]/60 font-medium tracking-widest uppercase">Assistant Thérapeute</span>
                            </div>
                        </Link>
                    </div>

                    <div className="text-center hidden lg:block absolute left-1/2 -translate-x-1/2">
                        <h1 className="font-inter font-semibold tracking-tight text-[#4a3f35] text-lg mb-0.5">
                            Agenda des Consultations
                        </h1>
                    </div>

                    {/* Section Droite */}
                    <div className="flex items-center gap-2 md:gap-3">
                        <Button variant="ghost" onClick={() => router.push("/")} className="text-[#bd613c] hover:bg-[#ebd9c8]/30">
                            <ArrowLeft className="w-4 h-4 mr-2 hidden sm:block" />
                            Retour
                        </Button>
                    </div>
                </div>
            </header>

            <main className="max-w-7xl mx-auto px-4 py-8">

                {/* Contrôles du calendrier */}
                <div className="flex flex-col sm:flex-row items-center justify-between mb-8 gap-4 bg-white p-4 rounded-2xl shadow-sm border border-[#ebd9c8]/50">
                    <div className="flex items-center gap-3">
                        <Button variant="outline" size="icon" onClick={prevWeek} className="border-[#ebd9c8] text-[#bd613c] hover:bg-[#ebd9c8]/20">
                            <ChevronLeft className="w-5 h-5" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={nextWeek} className="border-[#ebd9c8] text-[#bd613c] hover:bg-[#ebd9c8]/20">
                            <ChevronRight className="w-5 h-5" />
                        </Button>
                        <Button variant="ghost" onClick={goToday} className="font-medium text-[#bd613c] hover:bg-[#ebd9c8]/20 ml-2">
                            Aujourd'hui
                        </Button>
                    </div>

                    <h2 className="text-xl sm:text-2xl font-bebas tracking-wide text-[#bd613c] uppercase text-center">
                        Semaine du {format(weekDays[0], "d MMMM", { locale: fr })} au {format(weekDays[5], "d MMMM yyyy", { locale: fr })}
                    </h2>

                    <div className="flex flex-col items-center sm:items-end gap-3">
                        {/* Toggle Vue Mobile (uniquement visible sur md:hidden) */}
                        <div className="flex md:hidden bg-[#ebd9c8]/20 p-1 rounded-lg">
                            <button
                                onClick={() => setMobileView('liste')}
                                className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wider rounded-md transition-all ${mobileView === 'liste' ? 'bg-white shadow-sm text-[#bd613c]' : 'text-[#8c7b6d] hover:text-[#bd613c]'}`}
                            >
                                Liste
                            </button>
                            <button
                                onClick={() => setMobileView('semaine')}
                                className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wider rounded-md transition-all ${mobileView === 'semaine' ? 'bg-white shadow-sm text-[#bd613c]' : 'text-[#8c7b6d] hover:text-[#bd613c]'}`}
                            >
                                Semaine
                            </button>
                        </div>

                        <div className="flex items-center gap-4 text-xs font-medium uppercase tracking-wider">
                            <div className="flex items-center gap-2 text-orange-600">
                                <div className="w-3 h-3 rounded-sm bg-orange-100 border border-orange-200"></div>
                                Bilans
                            </div>
                            <div className="flex items-center gap-2 text-yellow-600">
                                <div className="w-3 h-3 rounded-sm bg-yellow-100 border border-yellow-200"></div>
                                Suivis
                            </div>
                        </div>
                    </div>
                </div>

                {/* Grille du Calendrier */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 animate-spin text-[#bd613c] mb-4" />
                        <p className="text-[#4a3f35]/60 font-medium">Chargement de l'agenda...</p>
                    </div>
                ) : (
                    <>
                        {/* Vue Mobile (Liste verticale) */}
                        <div className={`md:hidden space-y-6 ${mobileView === 'liste' ? 'block' : 'hidden'}`}>
                            {weekDays.map((day, i) => {
                                const dayEvents = events
                                    .filter((evt) => isSameDay(evt.date, day))
                                    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                                if (dayEvents.length === 0) return null;

                                return (
                                    <div key={i} className="bg-white rounded-2xl border border-[#ebd9c8]/50 shadow-sm overflow-hidden">
                                        <div className={`px-4 py-3 border-b border-[#ebd9c8]/50 ${isSameDay(day, new Date()) ? 'bg-[#bd613c]/10' : 'bg-[#ebd9c8]/10'}`}>
                                            <h3 className={`font-bebas tracking-wide text-xl capitalize ${isSameDay(day, new Date()) ? 'text-[#bd613c]' : 'text-[#4a3f35]'}`}>
                                                {format(day, "EEEE d MMMM yyyy", { locale: fr })}
                                            </h3>
                                        </div>
                                        <div className="p-4 flex flex-col gap-3">
                                            {dayEvents.map(evt => (
                                                <Link
                                                    href={`/consultation/${evt.consultationId}`}
                                                    key={evt.id}
                                                    className={`
                            block p-3 rounded-xl shadow-sm border transition-transform hover:scale-[1.02] hover:shadow-md cursor-pointer 
                            ${evt.type === 'bilan'
                                                            ? 'bg-orange-50 border-orange-200 text-orange-900'
                                                            : 'bg-yellow-50 border-yellow-200 text-yellow-900'
                                                        }
                          `}
                                                >
                                                    <div className="flex justify-between items-start mb-1">
                                                        <div className="font-semibold uppercase tracking-wide truncate pr-2">{evt.title}</div>
                                                        <div className="flex items-center gap-1 opacity-80 text-xs font-bold whitespace-nowrap bg-white/50 px-2 py-1 rounded-md">
                                                            <CalendarDays className="w-3.5 h-3.5" />
                                                            {format(evt.date, "HH:mm")}
                                                        </div>
                                                    </div>
                                                    <div className="text-xs opacity-70 font-medium uppercase tracking-wider">
                                                        {evt.type === 'bilan' ? 'Bilan' : 'Suivi'} - S{evt.sessionNumber}
                                                    </div>
                                                </Link>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Cas où la semaine est vide */}
                            {events.length === 0 && (
                                <div className="text-center py-12 bg-white rounded-2xl border border-[#ebd9c8]/50 border-dashed">
                                    <p className="text-[#4a3f35]/60 font-medium">Aucun rendez-vous planifié cette semaine.</p>
                                </div>
                            )}
                        </div>

                        {/* Vue Tablette/Desktop (Grille classique) OR Vue Semaine Mobile */}
                        <div className={`${mobileView === 'semaine' ? 'block' : 'hidden'} md:block bg-white rounded-2xl border border-[#ebd9c8]/50 shadow-sm overflow-x-auto`}>
                            <div className="min-w-[1000px]">
                                {/* En-tête des jours */}
                                <div className="grid grid-cols-[60px_repeat(6,1fr)] border-b border-[#ebd9c8]/50 bg-[#ebd9c8]/10 text-center">
                                    <div className="p-3 border-r border-[#ebd9c8]/30 sticky left-0 z-20 bg-[#fdfcfb]"></div>
                                    {weekDays.map((day, i) => (
                                        <div key={i} className={`min-w-0 p-3 border-r border-[#ebd9c8]/30 last:border-r-0 ${isSameDay(day, new Date()) ? 'bg-[#bd613c]/10' : ''}`}>
                                            <div className="text-xs uppercase tracking-widest font-semibold text-[#8c7b6d]">{format(day, "EEEE", { locale: fr })}</div>
                                            <div className={`text-xl font-bebas tracking-wide mt-1 ${isSameDay(day, new Date()) ? 'text-[#bd613c]' : 'text-[#4a3f35]'}`}>
                                                {format(day, "d MMM", { locale: fr })}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Corps de la grille (Heures) */}
                                <div className="relative">
                                    {TIME_SLOTS.map((slot, rowIdx) => (
                                        <div key={slot.id} className="grid grid-cols-[60px_repeat(6,1fr)] border-b border-[#ebd9c8]/30 last:border-b-0 h-[68px]">

                                            {/* Colonne de l'heure */}
                                            <div className="sticky left-0 z-10 flex items-center justify-end p-2 border-r border-[#ebd9c8]/30 text-xs font-semibold text-[#8c7b6d] bg-[#fdfcfb]">
                                                {slot.label}
                                            </div>

                                            {/* Cellules des jours pour cette heure */}
                                            {weekDays.map((day, colIdx) => {
                                                const cellEvents = events.filter(evt => {
                                                    const isSameD = isSameDay(evt.date, day);
                                                    if (!isSameD) return false;

                                                    let displayHour = evt.hour;
                                                    // Ramener les heures hors-pistes au créneau le plus proche pour affichage
                                                    if (displayHour < 9) displayHour = 9;
                                                    if (displayHour > 19) displayHour = 19;
                                                    // Cas spécial : si c'est 13h, ça tombe bien dans slot.id 13 (pause)

                                                    return displayHour === slot.id;
                                                });

                                                return (
                                                    <div
                                                        key={`${rowIdx}-${colIdx}`}
                                                        className={`min-w-0 relative p-1 border-r border-[#ebd9c8]/30 last:border-r-0 hover:bg-[#ebd9c8]/10 transition-colors ${isSameDay(day, new Date()) ? 'bg-[#bd613c]/5' : ''}`}
                                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            try {
                                                                const eventData = JSON.parse(e.dataTransfer.getData('text/plain'));
                                                                handleDropEvent(eventData, day, slot.id);
                                                            } catch (err) { }
                                                        }}
                                                    >
                                                        <div className="w-full h-full relative overflow-hidden flex flex-col gap-1 min-h-[50px]">
                                                            {cellEvents.map(evt => (
                                                                <div
                                                                    key={evt.id}
                                                                    onClick={(e) => {
                                                                        // Prevent navigation if we are dragging
                                                                        e.stopPropagation();
                                                                        router.push(`/consultation/${evt.consultationId}`);
                                                                    }}
                                                                    draggable
                                                                    onDragStart={(e) => {
                                                                        e.stopPropagation();
                                                                        e.dataTransfer.setData('text/plain', JSON.stringify({
                                                                            id: evt.id,
                                                                            type: evt.type,
                                                                            consultationId: evt.consultationId,
                                                                            dayStr: evt.dayStr
                                                                        }));
                                                                    }}
                                                                    className={`
                                                                      flex flex-col justify-center w-full h-full px-2 py-1 rounded-lg text-xs leading-tight shadow-sm border transition-all hover:shadow-md overflow-hidden min-h-[50px] cursor-move
                                                                      ${evt.type === 'bilan'
                                                                            ? 'bg-orange-50 border-orange-200 text-orange-900 hover:bg-orange-100'
                                                                            : 'bg-yellow-50 border-yellow-200 text-yellow-900 hover:bg-yellow-100'
                                                                        }
                                                                    `}
                                                                >
                                                                    <div className="font-semibold uppercase tracking-wide truncate w-full pointer-events-none">{evt.title}</div>
                                                                    <div className="flex items-center gap-1 opacity-80 text-[10px] font-medium w-full pointer-events-none">
                                                                        <CalendarDays className="w-3 h-3 shrink-0" />
                                                                        <span className="truncate">{format(evt.date, "HH:mm")} - S{evt.sessionNumber}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </>
                )}

            </main>
        </div>
    );
}
