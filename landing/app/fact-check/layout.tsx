import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';

export default async function FactCheckLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Redirect to sign-in if not authenticated
  if (!session?.userId) {
    redirect('/sign-in?redirect_url=/fact-check');
  }

  return (
    <div className="fact-check-auth-wrapper min-h-screen">
      {children}
    </div>
  );
}
