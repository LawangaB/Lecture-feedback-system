import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <h1 className="text-xl font-semibold">We couldn't find that page</h1>
      <p className="max-w-sm text-sm text-muted-foreground">The link may be wrong, or the page may have moved.</p>
      <Button asChild><Link to="/">Back to your dashboard</Link></Button>
    </div>
  );
}
