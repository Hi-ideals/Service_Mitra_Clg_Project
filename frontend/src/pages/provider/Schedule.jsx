import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, Trash2, CalendarOff, Calendar } from 'lucide-react';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Card, { CardBody, CardHeader } from '../../components/ui/Card.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Alert from '../../components/ui/Alert.jsx';
import { PageLoader } from '../../components/ui/Spinner.jsx';
import { formatDate } from '../../lib/format.js';
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
import PageHeader from '../../components/ui/PageHeader.jsx';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Schedule() {
  useDocumentTitle('My schedule');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [draft, setDraft] = useState([]);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockDate, setBlockDate] = useState('');
  const [blockReason, setBlockReason] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: keys.providers.schedule,
    queryFn: async () => (await api.get('/providers/me/schedule')).data,
  });

  // The API returns the week grouped by day; the editor works on a flat list.
  useEffect(() => {
    if (!data) return;
    setDraft(
      data.week.flatMap((day) =>
        day.windows.map((w) => ({
          dayOfWeek: day.dayOfWeek,
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      ),
    );
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.providers.schedule });

  const saveWeek = useMutation({
    mutationFn: (windows) => api.put('/providers/me/schedule', { windows }),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: keys.providers.me });
      toast.success('Weekly hours saved');
    },
    onError: (e) => toast.error(e.message),
  });

  const blockDay = useMutation({
    mutationFn: () =>
      api.post('/providers/me/schedule/exceptions', {
        date: blockDate,
        isAvailable: false,
        reason: blockReason || undefined,
      }),
    onSuccess: () => {
      refresh();
      setBlockOpen(false);
      setBlockDate('');
      setBlockReason('');
      toast.success('Date blocked');
    },
    // The API refuses to block a date that already has live bookings, and says
    // how many - which is exactly what the provider needs to hear.
    onError: (e) => toast.error(e.message),
  });

  const unblock = useMutation({
    mutationFn: (exceptionId) => api.delete('/providers/me/schedule/exceptions/' + exceptionId),
    onSuccess: () => {
      refresh();
      toast.success('Date reopened');
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <PageLoader />;

  const forDay = (dayOfWeek) => draft.filter((w) => w.dayOfWeek === dayOfWeek);
  const addWindow = (dayOfWeek) => setDraft([...draft, { dayOfWeek, startTime: '09:00', endTime: '18:00' }]);
  const removeWindow = (index) => setDraft(draft.filter((_, i) => i !== index));
  const patchWindow = (index, patch) => setDraft(draft.map((w, i) => (i === index ? { ...w, ...patch } : w)));

  return (
    <div className="page max-w-3xl py-5 sm:py-7">
      <PageHeader icon={Calendar} title="My schedule" />
      <p className="mt-1 text-base text-ink-500">
        Customers can only book slots inside these hours.
      </p>

      <Card className="mt-5">
        <CardHeader
          title="Weekly hours"
          action={
            <Button size="sm" loading={saveWeek.isPending} onClick={() => saveWeek.mutate(draft)}>
              Save week
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {DAYS.map((label, dayOfWeek) => {
            const windows = forDay(dayOfWeek);

            return (
              <div key={label} className="panel-tint p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className={clsx('font-medium', windows.length ? 'text-ink-900' : 'text-ink-400')}>
                    {label}
                  </p>
                  <Button variant="ghost" size="sm" icon={Plus} onClick={() => addWindow(dayOfWeek)}>
                    Add hours
                  </Button>
                </div>

                {windows.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-400">Not working</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {windows.map((w) => {
                      const index = draft.indexOf(w);
                      return (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            type="time"
                            aria-label={label + ' start time'}
                            value={w.startTime}
                            onChange={(e) => patchWindow(index, { startTime: e.target.value })}
                            containerClassName="flex-1"
                          />
                          <span className="text-sm text-ink-400">to</span>
                          <Input
                            type="time"
                            aria-label={label + ' end time'}
                            value={w.endTime}
                            onChange={(e) => patchWindow(index, { endTime: e.target.value })}
                            containerClassName="flex-1"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove these hours"
                            onClick={() => removeWindow(index)}
                            className="shrink-0 text-danger-600 hover:bg-danger-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title="Time off"
          subtitle="Block a specific date without changing your weekly hours."
          action={
            <Button size="sm" icon={CalendarOff} onClick={() => setBlockOpen(true)}>
              Block a date
            </Button>
          }
        />
        <CardBody className="p-0">
          {!data?.exceptions?.length ? (
            <p className="px-4 py-6 text-center text-base text-ink-500 sm:px-5">No time off booked.</p>
          ) : (
            <ul className="divide-y divide-ink-200">
              {data.exceptions.map((exception) => (
                <li key={exception.id} className="row-hover flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900">{formatDate(exception.date)}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {exception.isAvailable
                        ? 'Extra hours ' + exception.startTime + ' to ' + exception.endTime
                        : exception.reason || 'Not working'}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={'Reopen ' + exception.date}
                    onClick={() => unblock.mutate(exception.id)}
                    className="shrink-0 text-danger-600 hover:bg-danger-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Modal open={blockOpen} onClose={() => setBlockOpen(false)} title="Block a date">
        <div className="space-y-4">
          <Alert variant="info">
            You cannot block a date that already has bookings on it. Cancel or reschedule those
            first.
          </Alert>

          <Input
            label="Date"
            type="date"
            required
            min={new Date().toISOString().slice(0, 10)}
            value={blockDate}
            onChange={(e) => setBlockDate(e.target.value)}
          />

          <Input
            label="Reason"
            placeholder="Family function"
            hint="Optional. Shown to customers looking at your calendar."
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
          />

          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setBlockOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              loading={blockDay.isPending}
              disabled={!blockDate}
              onClick={() => blockDay.mutate()}
              className="flex-1"
            >
              Block this date
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
