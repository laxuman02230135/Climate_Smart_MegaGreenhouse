import type { Metadata } from 'next';
import { PrototypeSignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Create account' };

export default function PrototypeSignupPage() {
  return <PrototypeSignupForm />;
}
