import { Button, Card, EmptyState } from '@splito/ui';
import { Orbit } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        action={
          <Button asChild>
            <Link to="/">Return to your orbit</Link>
          </Button>
        }
        description="This route does not exist, or it is no longer available to your account."
        icon={Orbit}
        title="That page drifted away"
      />
    </Card>
  );
}
