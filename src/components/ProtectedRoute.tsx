"use client";

// Le praticien ne souhaite plus d'authentification par email.
// Ce wrapper agit désormais comme un passe-plat simple sans blocage Supabase Auth.
export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
