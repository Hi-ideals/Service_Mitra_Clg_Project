import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Wallet, Clock, TrendingUp, Receipt, Briefcase, Check } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Pagination from '../../components/ui/Pagination.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { money, formatDate, formatDateTime, humanise } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PayoutDetailsCard from '../../components/provider/PayoutDetailsCard.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';

const ENTRY_LABELS = {
  job_earning: 'Job payment',
  commission: 'Platform commission',
  refund_reversal: 'Refund adjustment',
  payout: 'Paid out to you',
  adjustment: 'Adjustment',
  penalty: 'Penalty',
};

/**
 * The reference is written into the description when the ledger row is
 * created - "Switch & Socket Repair (BK-L5FTKG)" - and the table shows it in
 * a column of its own. Without this it appears twice on the same line.
 */
function withoutReference(description, reference) {
  if (!description) return '';
  return reference ? description.replace(' (' + reference + ')', '').trim() : description.trim();
}

/**
 * The second line, with anything the first line already said taken out.
 *
 * The stored description often repeats its own label - "Platform commission"
 * followed by "Platform commission at 15%" - which reads as a stutter once
 * the two sit on top of each other in a cell.
 */
function detailFor(entry) {
  const label = ENTRY_LABELS[entry.type] || humanise(entry.type);
  const text = withoutReference(entry.description, entry.bookingReference);
  if (!text || text === label) return '';

  // Left as written. What remains after the label is usually a continuation
  // of it - "Platform commission" / "at 15%" - and capitalising that reads as
  // two sentences colliding rather than one phrase.
  return text.toLowerCase().startsWith(label.toLowerCase())
    ? text.slice(label.length).replace(/^[\s:·-]+/, '')
    : text;
}

/**
 * Whether the money is spendable yet.
 *
 * A job's earning is held until the customer's window for raising a problem
 * closes. Saying which day it frees up answers the only question a provider
 * has when they see a figure they cannot withdraw.
 */
function availability(entry) {
  if (entry.type === 'payout') return null;

  // Once the money has gone out, "Available" is no longer true - it is not
  // waiting to be withdrawn, it has already been sent.
  if (entry.isPaidOut) return { held: false, sent: true, label: 'Sent' };

  const at = entry.availableAt ? new Date(entry.availableAt) : null;
  if (!at || at <= new Date()) return { held: false, label: 'Available' };

  // The window is often hours rather than days, and "held until 16 October"
  // on the sixteenth tells a provider nothing. Same day, give the time.
  const sameDay = at.toDateString() === new Date().toDateString();
  const when = sameDay
    ? at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : formatDate(entry.availableAt);

  return { held: true, label: 'Held until ' + when };
}

function Amount({ minor, amount, strong = false }) {
  const out = minor < 0;
  return (
    <span
      className={clsx(
        'tabular-nums',
        strong ? 'text-base font-semibold' : 'font-semibold',
        out ? 'text-ink-600' : 'text-success-700',
      )}
    >
      {out ? '−' : '+'}{money(Math.abs(amount))}
    </span>
  );
}

/** How many jobs are listed on one page of the statement. */
const GROUPS_PER_PAGE = 6;

/**
 * How far back the statement reaches in one request.
 *
 * 50 is the ceiling the earnings endpoint validates against - asking for
 * more is refused outright, not trimmed. The page says so plainly when there
 * are older movements behind it.
 */
const LEDGER_LIMIT = 50;

/**
 * One box per job, rather than one row per movement.
 *
 * A single visit writes two or three separate lines - the payment, the
 * commission taken off it, and later the payout that swept it up. Read as a
 * flat list they are three unrelated numbers; read together they answer the
 * question a provider actually has, which is "what did I end up with for
 * that job".
 *
 * Movements with no booking behind them - a payout covers many jobs, an
 * adjustment none - stand on their own, because there is no service to file
 * them under.
 */
function groupByJob(entries) {
  const groups = [];
  const byReference = new Map();

  for (const entry of entries) {
    if (!entry.bookingReference) {
      groups.push({
        key: entry.id,
        title: ENTRY_LABELS[entry.type] || humanise(entry.type),
        reference: null,
        at: entry.createdAt,
        entries: [entry],
      });
      continue;
    }

    let group = byReference.get(entry.bookingReference);
    if (!group) {
      group = {
        key: entry.bookingReference,
        // Filled in below by whichever line names the service.
        title: null,
        reference: entry.bookingReference,
        at: entry.createdAt,
        entries: [],
      };
      byReference.set(entry.bookingReference, group);
      groups.push(group);
    }

    group.entries.push(entry);
    // The earning line carries the service name; the commission line does not.
    if (!group.title && entry.type === 'job_earning') {
      group.title = withoutReference(entry.description, entry.bookingReference);
    }
  }

  const ORDER = { job_earning: 0, refund_reversal: 1, commission: 2, adjustment: 3, penalty: 4 };

  return groups.map((g) => {
    const entries = [...g.entries].sort(
      (a, b) => (ORDER[a.type] ?? 9) - (ORDER[b.type] ?? 9),
    );
    const netMinor = entries.reduce((sum, e) => sum + e.amountMinor, 0);

    return {
      ...g,
      entries,
      title: g.title || withoutReference(entries[0].description, g.reference),
      netMinor,
      net: netMinor / 100,
      // A payout or an adjustment is one line standing alone. Repeating it as
      // a heading above itself says the same thing twice.
      standalone: entries.length === 1 && !g.reference,
      /**
       * The transfer that settled this job, when one has.
       *
       * Named on the job rather than nested under it, because a payout
       * sweeps every earning a provider has available - one transfer
       * routinely settles three visits at once, so it belongs to none of
       * them on its own.
       */
      payout: entries.every((e) => e.isPaidOut) ? entries[0].payoutReference : null,
    };
  });
}

export default function Earnings() {
  useDocumentTitle('Earnings');

  // The statement is paged over jobs rather than over movements, so the page
  // size is decided here and not by the request.
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: keys.earnings({ limit: LEDGER_LIMIT }),
    queryFn: async () => (await api.get('/earnings', { params: { limit: LEDGER_LIMIT } })).data,
  });

  const entries = data?.entries ?? [];
  // Grouping walks the whole list, so it is held across renders rather than
  // redone every time the page number changes.
  const groups = useMemo(() => groupByJob(entries), [entries]);
  const totalPages = Math.max(1, Math.ceil(groups.length / GROUPS_PER_PAGE));
  const visibleGroups = groups.slice((page - 1) * GROUPS_PER_PAGE, page * GROUPS_PER_PAGE);

  if (isLoading) return <PageLoader label="Loading your earnings" />;
  if (!data) return null;

  const { balance, report, byMonth, total } = data;

  return (
    <div className="page max-w-4xl py-5 sm:py-7">
      <PageHeader icon={Wallet} title="Earnings" />

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Wallet aria-hidden="true" className="h-4 w-4 text-brand-600" />
            <p className="text-sm font-medium text-ink-500">Available now</p>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-ink-900">{money(balance.available)}</p>
          <p className="mt-0.5 text-xs text-ink-400">Released in the next payout run</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <Clock aria-hidden="true" className="h-4 w-4 text-warning-600" />
            <p className="text-sm font-medium text-ink-500">Still held</p>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-ink-900">{money(balance.pending)}</p>
          <p className="mt-0.5 text-xs text-ink-400">Inside the dispute window</p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2">
            <TrendingUp aria-hidden="true" className="h-4 w-4 text-success-600" />
            <p className="text-sm font-medium text-ink-500">Lifetime</p>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-ink-900">{money(balance.lifetime)}</p>
          <p className="mt-0.5 text-xs text-ink-400">Net of commission</p>
        </Card>
      </div>

      {/* ---------- what was earned, and what it cost ---------- */}
      {report?.jobs > 0 && (
        <Card className="mt-4">
          <CardHeader
            title="Your earnings report"
            subtitle={
              report.since
                ? 'Since ' + formatDate(report.since) + ' · ' + report.jobs +
                  (report.jobs === 1 ? ' job' : ' jobs')
                : undefined
            }
          />
          <CardBody>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="panel-tint rounded-field p-3">
                <div className="flex items-center gap-1.5 text-ink-500">
                  <Briefcase aria-hidden="true" className="h-3.5 w-3.5" />
                  <p className="text-xs font-medium uppercase tracking-wide">You earned</p>
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums text-ink-900">
                  {money(report.gross)}
                </p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {money(report.averagePerJob)} per job on average
                </p>
              </div>

              <div className="panel-tint rounded-field p-3">
                <div className="flex items-center gap-1.5 text-ink-500">
                  <Receipt aria-hidden="true" className="h-3.5 w-3.5" />
                  <p className="text-xs font-medium uppercase tracking-wide">Commission paid</p>
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums text-warning-700">
                  −{money(report.commission)}
                </p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {report.effectiveCommissionPercent}% of what you earned
                </p>
              </div>

              <div className="rounded-field border border-ink-200 bg-brand-50/50 p-3">
                <div className="flex items-center gap-1.5 text-ink-500">
                  <Wallet aria-hidden="true" className="h-3.5 w-3.5" />
                  <p className="text-xs font-medium uppercase tracking-wide">You keep</p>
                </div>
                <p className="mt-1 text-xl font-semibold tabular-nums text-success-700">
                  {money(report.net)}
                </p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {money(report.paidOut)} already transferred to you
                </p>
              </div>
            </div>

            {report.otherDeductionsMinor > 0 && (
              <p className="mt-3 text-sm text-ink-500">
                Includes {money(report.otherDeductions)} in adjustments. Every one of them is a line
                in the statement below.
              </p>
            )}

            {byMonth?.some((m) => m.jobs > 0) && (
              <div className="no-scrollbar -mx-4 mt-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="data-table w-full min-w-[26rem] text-sm">
                  <thead>
                    <tr>
                      <th className="!px-2">Month</th>
                      <th className="!px-2 text-right">Jobs</th>
                      <th className="!px-2 text-right">Earned</th>
                      <th className="!px-2 text-right">Commission</th>
                      <th className="!px-2 text-right">You keep</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-200">
                    {byMonth.map((m) => (
                      <tr key={m.period} className={m.jobs ? undefined : 'text-ink-400'}>
                        <td className="whitespace-nowrap !px-2">{m.label}</td>
                        <td className="!px-2 text-right tabular-nums">{m.jobs}</td>
                        <td className="!px-2 text-right tabular-nums">{money(m.gross)}</td>
                        <td className="!px-2 text-right tabular-nums text-warning-700">
                          {m.commission ? '−' + money(m.commission) : '—'}
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums">
                          {money(m.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <PayoutDetailsCard />

      {balance.pendingMinor > 0 && (
        <Alert variant="info" className="mt-4">
          Money from a completed job is held until the dispute window closes, then released in the
          next payout run.
        </Alert>
      )}

      <Card className="mt-4">
        <CardHeader
          title="Statement"
          subtitle="Every movement on your balance, grouped by the job it belongs to."
        />
        <CardBody className="p-0">
          {entries.length === 0 ? (
            <EmptyState
              compact
              icon={Wallet}
              title="Nothing here yet"
              description="Completed and paid jobs appear here."
            />
          ) : (
            <>
              {/*
                One table, one bordered section per job. A table is the right
                shape for money - the columns line up and the eye runs down
                them - and tbody is how a table groups rows without breaking
                that alignment.
              */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="data-table w-full text-base">
                  <thead>
                    <tr>
                      <th scope="col">Movement</th>
                      <th scope="col">When</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="text-right">Amount</th>
                    </tr>
                  </thead>

                  {visibleGroups.map((group) => (
                    <tbody key={group.key} className="border-b-4 border-ink-100 last:border-b-0">
                      {!group.standalone && (
                      <tr className="bg-ink-50/70">
                        <th scope="colgroup" colSpan={3} className="!py-2 text-left">
                          <span className="font-semibold normal-case tracking-normal text-ink-900">
                            {group.title}
                          </span>
                          {group.reference && (
                            <span className="ml-2 font-mono text-xs font-normal normal-case tracking-normal text-ink-400">
                              {group.reference}
                            </span>
                          )}
                        </th>
                        <th scope="colgroup" className="!py-2 text-right">
                          {group.payout && (
                            <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-success-50 px-2 py-0.5 text-xs font-semibold normal-case tracking-normal text-success-700 ring-1 ring-inset ring-success-600/20">
                              <Check aria-hidden="true" className="h-3 w-3" />
                              Sent
                              <span className="font-mono font-normal text-success-700/70">
                                {group.payout}
                              </span>
                            </span>
                          )}
                          {group.entries.length > 1 && (
                            <span className="mr-1 text-xs font-medium normal-case tracking-normal text-ink-500">
                              Net
                            </span>
                          )}
                          <Amount minor={group.netMinor} amount={group.net} strong />
                        </th>
                      </tr>
                      )}

                      {group.entries.map((entry) => {
                        const state = availability(entry);
                        const detail = detailFor(entry);
                        return (
                          <tr key={entry.id}>
                            <td className={group.standalone ? undefined : 'pl-6'}>
                              <span className="font-medium text-ink-800">
                                {ENTRY_LABELS[entry.type] || humanise(entry.type)}
                              </span>
                              {detail && detail !== group.title && (
                                <span className="ml-1.5 text-sm text-ink-500">{detail}</span>
                              )}
                              {entry.coversBookings > 1 && (
                                <span className="ml-1.5 text-sm text-ink-500">
                                  {'\u00b7 covers ' + entry.coversBookings + ' jobs'}
                                </span>
                              )}
                            </td>
                            <td className="whitespace-nowrap text-sm text-ink-500">
                              {formatDateTime(entry.createdAt)}
                            </td>
                            <td className="whitespace-nowrap">
                              {state ? (
                                <Badge variant={state.held ? 'warning' : 'success'} size="sm">
                                  {state.label}
                                </Badge>
                              ) : (
                                <span className="text-sm text-ink-400">Sent</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap text-right">
                              <Amount minor={entry.amountMinor} amount={entry.amount} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>

              {/* Four columns at 375px cannot be read however they are
                  styled, so a phone gets the same grouping as cards. */}
              <div className="divide-y divide-ink-200 sm:hidden">
                {visibleGroups.map((group) => (
                  <div key={group.key} className="px-4 py-3">
                    {!group.standalone && (
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-ink-900">{group.title}</p>
                          {group.reference && (
                            <p className="mt-0.5 font-mono text-xs text-ink-400">
                              {group.reference}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <Amount minor={group.netMinor} amount={group.net} strong />
                          {group.payout && (
                            <span className="mt-0.5 flex items-center justify-end gap-1 text-xs font-semibold text-success-700">
                              <Check aria-hidden="true" className="h-3 w-3" />
                              Sent
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    <div
                      className={clsx(
                        'space-y-2',
                        !group.standalone && 'mt-2 border-l-2 border-ink-100 pl-3',
                      )}
                    >
                      {group.entries.map((entry) => {
                        const state = availability(entry);
                        return (
                          <div key={entry.id}>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-sm text-ink-600">
                                {ENTRY_LABELS[entry.type] || humanise(entry.type)}
                              </span>
                              <Amount minor={entry.amountMinor} amount={entry.amount} />
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-xs text-ink-400">
                                {formatDateTime(entry.createdAt)}
                              </span>
                              {state && (
                                <Badge variant={state.held ? 'warning' : 'success'} size="sm">
                                  {state.label}
                                </Badge>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {totalPages > 1 && (
                <div className="border-t border-ink-200 px-4 py-3">
                  <Pagination page={page} totalPages={totalPages} onChange={setPage} />
                </div>
              )}

              {/*
                The API returns the most recent hundred movements. Saying so
                beats a statement that quietly stops, which reads as missing
                money rather than as a page limit.
              */}
              {total > entries.length && (
                <p className="border-t border-ink-200 px-4 py-2.5 text-sm text-ink-500">
                  Showing the latest {entries.length} of {total} movements.
                </p>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
