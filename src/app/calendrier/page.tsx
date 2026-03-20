"use client";

import { useEffect, useState } from "react";
import { supabase, SupabaseConsultation } from "@/lib/supabaseClient";
import { format, startOfWeek, addDays, subWeeks, addWeeks, isSameDay, getHours } from "date-fns";
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
}

export default function CalendarPage() {
    const router = useRouter();
    const [consultations, setConsultations] = useState<SupabaseConsultation[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentWeekStart, setCurrentWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

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

    // Générer tous les événements (un par jour unique par patient)
    const events: CalendarEvent[] = [];
    consultations.forEach(c => {
        // 1. Collecter toutes les interactions (bilan + suivis)
        const interactions: { date: Date, type: 'bilan' | 'suivi' }[] = [];

        if (c.date) {
            interactions.push({ date: new Date(c.date), type: 'bilan' });
        }

        if (c.follow_ups && Array.isArray(c.follow_ups)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            c.follow_ups.forEach((f: any) => {
                if (f.date || f.created_at) {
                    interactions.push({ date: new Date(f.date || f.created_at), type: 'suivi' });
                }
            });
        }

        // 2. Grouper par jour (YYYY-MM-DD)
        const groupedByDay: Record<string, { date: Date, type: 'bilan' | 'suivi' }[]> = {};
        interactions.forEach(int => {
            const dayStr = int.date.toISOString().split('T')[0];
            if (!groupedByDay[dayStr]) groupedByDay[dayStr] = [];
            groupedByDay[dayStr].push(int);
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
            });
        });
    });

    const nextWeek = () => setCurrentWeekStart(addWeeks(currentWeekStart, 1));
    const prevWeek = () => setCurrentWeekStart(subWeeks(currentWeekStart, 1));
    const goToday = () => setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

    // Afficher de Lundi (0) à Samedi (5)
    const weekDays = Array.from({ length: 6 }).map((_, i) => addDays(currentWeekStart, i));

    // Plage horaire 09:00 - 20:00 (index 0 = 9h, index 11 = 20h)
    const HOURS = Array.from({ length: 12 }).map((_, i) => i + 9);

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

                    <div className="text-center hidden sm:block absolute left-1/2 -translate-x-1/2">
                        <h1 className="font-inter font-semibold tracking-tight text-[#4a3f35] text-lg lg:text-xl mb-0.5">
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

                {/* Grille du Calendrier */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <Loader2 className="w-10 h-10 animate-spin text-[#bd613c] mb-4" />
                        <p className="text-[#4a3f35]/60 font-medium">Chargement de l'agenda...</p>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-[#ebd9c8]/50 shadow-sm overflow-x-auto">
                        <div className="min-w-[800px]">
                            {/* En-tête des jours */}
                            <div className="grid grid-cols-[60px_repeat(6,1fr)] border-b border-[#ebd9c8]/50 bg-[#ebd9c8]/10 text-center">
                                <div className="p-3 border-r border-[#ebd9c8]/30"></div>
                                {weekDays.map((day, i) => (
                                    <div key={i} className={`p-3 border-r border-[#ebd9c8]/30 last:border-r-0 ${isSameDay(day, new Date()) ? 'bg-[#bd613c]/10' : ''}`}>
                                        <div className="text-xs uppercase tracking-widest font-semibold text-[#8c7b6d]">{format(day, "EEEE", { locale: fr })}</div>
                                        <div className={`text-xl font-bebas tracking-wide mt-1 ${isSameDay(day, new Date()) ? 'text-[#bd613c]' : 'text-[#4a3f35]'}`}>
                                            {format(day, "d MMM", { locale: fr })}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Corps de la grille (Heures) */}
                            <div className="relative">
                                {HOURS.map((hour, rowIdx) => (
                                    <div key={hour} className="grid grid-cols-[60px_repeat(6,1fr)] border-b border-[#ebd9c8]/30 last:border-b-0 min-h-[80px]">

                                        {/* Colonne de l'heure */}
                                        <div className="p-2 border-r border-[#ebd9c8]/30 text-right text-xs font-semibold text-[#8c7b6d] bg-[#fdfcfb]">
                                            {hour}h00
                                        </div>

                                        {/* Cellules des jours pour cette heure */}
                                        {weekDays.map((day, colIdx) => {
                                            // Trouver les événements qui correspondent à ce jour ET à cette heure
                                            // Si l'heure de l'événement n'est pas dans [9..20], on l'affiche a la première case (9h) s'il est avant 9h, ou à la dernière (20h) s'il est après.
                                            const cellEvents = events.filter(evt => {
                                                const isSameD = isSameDay(evt.date, day);
                                                if (!isSameD) return false;

                                                let displayHour = evt.hour;
                                                if (displayHour < 9) displayHour = 9;
                                                if (displayHour > 20) displayHour = 20;

                                                return displayHour === hour;
                                            });

                                            return (
                                                <div key={`${rowIdx}-${colIdx}`} className={`relative p-1.5 border-r border-[#ebd9c8]/30 last:border-r-0 hover:bg-[#ebd9c8]/5 transition-colors ${isSameDay(day, new Date()) ? 'bg-[#ebd9c8]/5' : ''}`}>
                                                    <div className="flex flex-col gap-1.5 h-full">
                                                        {cellEvents.map(evt => (
                                                            <Link
                                                                href={`/consultation/${evt.consultationId}`}
                                                                key={evt.id}
                                                                className={`
                                  block p-2 rounded-lg text-xs leading-tight shadow-sm border transition-transform hover:scale-[1.02] hover:shadow-md cursor-pointer 
                                  ${evt.type === 'bilan'
                                                                        ? 'bg-orange-50 border-orange-200 text-orange-900 hover:bg-orange-100'
                                                                        : 'bg-yellow-50 border-yellow-200 text-yellow-900 hover:bg-yellow-100'
                                                                    }
                                `}
                                                            >
                                                                <div className="font-semibold uppercase tracking-wide truncate mb-0.5">{evt.title}</div>
                                                                <div className="flex items-center gap-1 opacity-80 text-[10px] font-medium">
                                                                    <CalendarDays className="w-3 h-3" />
                                                                    {format(evt.date, "HH:mm")} - {evt.type === 'bilan' ? 'Bilan' : 'Suivi'}
                                                                </div>
                                                            </Link>
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
                )}

            </main>
        </div>
    );
}
