import { useState, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { setAuthenticated } from '../../lib/auth';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Lock, ArrowRight } from 'lucide-react';

export default function AdminLoginPage() {
  const [email, setEmail] = useState('manager@gelafehaus.com');
  const [password, setPassword] = useState('gelafe123');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    let valid = true;
    if (!email.trim()) {
      setEmailError('Email is required');
      valid = false;
    } else if (!email.includes('@')) {
      setEmailError('Please enter a valid email');
      valid = false;
    } else {
      setEmailError('');
    }

    if (!password.trim()) {
      setPasswordError('Password is required');
      valid = false;
    } else if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      valid = false;
    } else {
      setPasswordError('');
    }

    if (!valid) return;

    setLoading(true);
    setTimeout(() => {
      setAuthenticated(true);
      setLoading(false);
      navigate('/admin');
    }, 400);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="h-12 w-12 rounded-[14px] bg-primary flex items-center justify-center font-heading font-black text-white text-2xl mx-auto mb-3 shadow-[var(--shadow-sm)]">
            G
          </div>
          <h1 className="text-2xl font-heading font-bold text-ink">Gelafehaus Admin</h1>
          <p className="text-sm text-muted mt-1">Sign in to manage kitchen orders and menu</p>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-[var(--radius-card)] p-6 sm:p-8 border border-border shadow-[var(--shadow-lg)]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              id={emailId}
              label="Email address"
              type="email"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
              }}
              error={emailError}
              placeholder="admin@gelafehaus.com"
              required
            />

            <Input
              id={passwordId}
              label="Password"
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              error={passwordError}
              placeholder="••••••••"
              required
            />

            <div className="pt-2">
              <Button
                type="submit"
                size="lg"
                className="w-full font-bold flex items-center justify-center gap-2"
                loading={loading}
              >
                <span>Sign in to dashboard</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </form>

          <div className="mt-6 pt-4 border-t border-border text-center">
            <p className="text-xs text-muted flex items-center justify-center gap-1.5">
              <Lock className="h-3 w-3" />
              Demo access: any email/password works
            </p>
          </div>
        </div>

        {/* Customer App Link */}
        <div className="text-center mt-6">
          <a
            href="/"
            className="text-xs font-semibold text-primary hover:text-primary-hover underline underline-offset-4"
          >
            ← Go to Customer Ordering App
          </a>
        </div>
      </div>
    </div>
  );
}
