"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lock } from "lucide-react";

export default function LoginPage() {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const router = useRouter();
    const { toast } = useToast();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                toast({
                    title: "Erreur de connexion",
                    description: error.message,
                    variant: "destructive",
                });
            } else {
                toast({
                    title: "Connecté !",
                    description: "Bienvenue sur TDT Bilan.",
                });
                router.push("/");
            }
        } catch (err: unknown) {
            toast({
                title: "Erreur inattendue",
                description: err instanceof Error ? err.message : "Impossible de se connecter.",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-[#fdfbf6] px-4">
            <div className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden border border-neutral-100">
                <div className="p-8">
                    <div className="flex justify-center mb-6">
                        <div className="bg-orange-100 p-3 rounded-full text-orange-600">
                            <Lock size={32} strokeWidth={1.5} />
                        </div>
                    </div>

                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bebas text-neutral-800 tracking-wide mb-2">TDT Bilan</h1>
                        <p className="text-neutral-500 font-sans text-sm">Authentification sécurisée (Secret Médical)</p>
                    </div>

                    <form onSubmit={handleLogin} className="space-y-5">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="votre@email.com"
                                required
                                className="w-full"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="password">Mot de passe</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                                className="w-full"
                            />
                        </div>

                        <Button
                            type="submit"
                            className="w-full bg-orange-500 hover:bg-orange-600 text-white shadow-md shadow-orange-500/20 py-6 text-lg rounded-xl"
                            disabled={loading}
                        >
                            {loading ? "Connexion..." : "Accéder à mes bilans"}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
}
