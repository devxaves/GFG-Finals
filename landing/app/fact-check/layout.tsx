export default function FactCheckLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fact-check-wrapper min-h-screen">
      {children}
    </div>
  );
}
