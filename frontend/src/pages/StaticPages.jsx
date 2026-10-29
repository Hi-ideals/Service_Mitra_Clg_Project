import { Link } from 'react-router-dom';
import {
  ShieldCheck, Clock, BadgeIndianRupee, MessageSquare, Phone, Mail, Wrench,
  CheckCircle2, Wallet, CalendarCheck, HelpCircle,
} from 'lucide-react';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import Card, { CardBody, CardHeader } from '../components/ui/Card.jsx';
import Button from '../components/ui/Button.jsx';

export function About() {
  useDocumentTitle('About');

  return (
    <div className="page relative max-w-prose py-8 sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-10 h-64 bg-hero-glow"
      />
      <h1 className="relative text-3xl font-bold tracking-tight sm:text-4xl">About ServiceMitra</h1>

      <div className="relative mt-5 space-y-4 text-md leading-relaxed text-ink-600">
        <p>
          ServiceMitra connects people in Bidar with verified local professionals - plumbers,
          electricians, carpenters, AC technicians and more.
        </p>
        <p>
          Finding someone reliable for work at home usually means asking around and hoping. We
          built ServiceMitra so that it does not have to: every professional on the platform has had
          their identity and address checked before they can accept a single booking.
        </p>
      </div>

      <div className="stagger relative mt-8 grid gap-4 sm:grid-cols-3">
        {[
          { icon: ShieldCheck, title: 'Verified', body: 'ID and address checked before anyone goes live.' },
          { icon: Clock, title: 'Real slots', body: 'You book a time the professional actually has free.' },
          { icon: BadgeIndianRupee, title: 'Clear pricing', body: 'Agreed before the job, confirmed before you pay.' },
        ].map((item) => (
          <Card key={item.title} className="p-4">
            <span className="icon-chip icon-chip-brand h-9 w-9">
              <item.icon aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
            </span>
            <h2 className="mt-3 font-semibold text-ink-900">{item.title}</h2>
            <p className="mt-1 text-base text-ink-500">{item.body}</p>
          </Card>
        ))}
      </div>

      <h2 className="mt-10 text-xl font-semibold">Terms in brief</h2>
      <ul className="mt-4 space-y-2.5 text-base text-ink-600">
        {[
          'You pay after the work is done, never before.',
          'Cancelling more than 12 hours ahead is free. Later than that, a fee may apply.',
          'If something goes wrong, you can raise a dispute for 48 hours after the job.',
          'Your address and phone number reach the professional only once they accept.',
        ].map((term) => (
          <li key={term} className="flex gap-2.5">
            <CheckCircle2 aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-brand-600" />
            {term}
          </li>
        ))}
      </ul>
    </div>
  );
}

const FAQS = [
  {
    q: 'When do I pay?',
    a: 'After the job is finished. The professional confirms the final amount with you, you receive a code by email, and payment happens after that.',
  },
  {
    q: 'What if the price changes?',
    a: 'The final amount appears in the email you receive before you read the completion code out. Reading it out is your agreement to that amount, and it can never exceed the platform ceiling for that service.',
  },
  {
    q: 'Can I cancel?',
    a: 'Yes. Before the professional accepts it is always free. After that, cancelling more than 12 hours ahead is free; later than that a fee applies. You see the exact figure before you confirm.',
  },
  {
    q: 'Something went wrong with the work.',
    a: 'Open the booking and raise a dispute within 48 hours of completion. The provider payout is held while our team looks into it, and a refund can be issued in full or in part.',
  },
  {
    q: 'How are professionals verified?',
    a: 'Every provider submits identity and address proof, and licensed trades submit their certification. Our team reviews each submission by hand. Nobody appears in search until they are approved.',
  },
  {
    q: 'Who sees my address?',
    a: 'Only the professional you booked, and only once they have accepted. Before that they see the city and pincode, which is what they need to decide whether they cover your area.',
  },
];

export function Help() {
  useDocumentTitle('Help and support');

  return (
    <div className="page relative max-w-prose py-8 sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-10 h-64 bg-hero-glow"
      />
      <h1 className="relative text-3xl font-bold tracking-tight sm:text-4xl">Help and support</h1>

      <div className="stagger relative mt-6 space-y-3">
        {FAQS.map((faq) => (
          <Card key={faq.q} className="transition-shadow duration-200 hover:shadow-card-hover">
            <CardBody>
              <h2 className="flex gap-2.5 font-semibold text-ink-900">
                <HelpCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                {faq.q}
              </h2>
              <p className="mt-1.5 pl-[1.625rem] text-base leading-relaxed text-ink-600">{faq.a}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card className="mt-6">
        <CardHeader title="Still stuck?" subtitle="We answer within one working day." />
        <CardBody className="flex flex-col gap-3 sm:flex-row">
          {/* The number and address are spelled out, not just linked: on a
              laptop a tel: link opens nothing, and the visitor needs to read it. */}
          <Button as="a" href="tel:+919141555444" variant="secondary" icon={Phone}>
            Call +91 91415 55444
          </Button>
          <Button as="a" href="mailto:servicemitra01@gmail.com" variant="secondary" icon={Mail}>
            servicemitra01@gmail.com
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

const PROVIDER_STEPS = [
  { icon: Wrench, title: 'Create your account', body: 'Tell us your trade, your prices and the areas you cover.' },
  { icon: ShieldCheck, title: 'Get verified', body: 'Upload your ID and address proof. Our team reviews it by hand.' },
  { icon: CalendarCheck, title: 'Set your hours', body: 'Customers can only book slots you have actually made available.' },
  { icon: Wallet, title: 'Get paid', body: 'Your earning is credited on completion and released after the dispute window.' },
];

export function ForProviders() {
  useDocumentTitle('For professionals');

  return (
    <div className="page relative max-w-3xl py-8 sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-10 h-64 bg-hero-glow"
      />
      <h1 className="relative text-3xl font-bold tracking-tight sm:text-4xl">Work on ServiceMitra</h1>
      <p className="mt-3 text-md text-ink-600">
        Set your own prices and hours. Get paid for every completed job, with an invoice for each
        one.
      </p>

      <ol className="stagger relative mt-8 space-y-5">
        {PROVIDER_STEPS.map((step, index) => (
          <li key={step.title} className="relative flex gap-4">
            {/* A spine joining the steps, so four items read as a sequence
                rather than four unrelated statements. It stops at the last
                number, which has nothing after it to connect to. */}
            {index < PROVIDER_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[1.3125rem] top-12 h-[calc(100%-1.5rem)] w-0.5 rounded-pill
                           bg-gradient-to-b from-brand-200 to-transparent"
              />
            )}
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-field
                             bg-brand-gradient font-display text-lg font-bold text-white shadow-btn">
              {index + 1}
            </span>
            <div className="pt-1">
              <h2 className="flex items-center gap-2 font-semibold text-ink-900">
                <step.icon aria-hidden="true" className="h-4 w-4 text-brand-600" />
                {step.title}
              </h2>
              <p className="mt-1 text-base leading-relaxed text-ink-600">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <Card className="mt-8">
        <CardHeader title="What we ask of you" />
        <CardBody>
          <ul className="space-y-2">
            {[
              'Respond to booking requests promptly - unanswered requests are cancelled automatically.',
              'Turn up at the time you accepted, or cancel early enough for the customer to rebook.',
              'Charge what you quoted, unless the customer agrees to a revised amount.',
            ].map((rule) => (
              <li key={rule} className="flex gap-2 text-base text-ink-600">
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                {rule}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button as={Link} to="/register?role=provider" size="lg">
          Join as a professional
        </Button>
        <Button as={Link} to="/help" variant="secondary" size="lg" icon={MessageSquare}>
          Ask a question first
        </Button>
      </div>
    </div>
  );
}

export default About;
