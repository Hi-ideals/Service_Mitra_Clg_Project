import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { keys } from '../../lib/queryClient.js';
import { useToast } from '../../context/ToastContext.jsx';
import Modal from '../../components/ui/Modal.jsx';
import Button from '../../components/ui/Button.jsx';
import Input from '../../components/ui/Input.jsx';
import Textarea from '../../components/ui/Textarea.jsx';
import StarRating from '../../components/ui/StarRating.jsx';
import Alert from '../../components/ui/Alert.jsx';

const LABELS = ['', 'Poor', 'Not great', 'Fine', 'Good', 'Excellent'];

const SUB_RATINGS = [
  { key: 'punctuality', label: 'Turned up on time' },
  { key: 'quality', label: 'Quality of work' },
  { key: 'behaviour', label: 'Manner and conduct' },
];

export default function ReviewDialog({ open, onClose, booking }) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [rating, setRating] = useState(0);
  const [subRatings, setSubRatings] = useState({});
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState(null);

  const submit = useMutation({
    mutationFn: (payload) => api.post('/reviews', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: keys.reviews.pending });
      queryClient.invalidateQueries({ queryKey: ['providers'] });
      toast.success('Thanks - your review is published');
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  function onSubmit(event) {
    event.preventDefault();
    if (!rating) {
      setError('Choose a star rating first');
      return;
    }
    setError(null);
    submit.mutate({
      bookingId: booking.id,
      rating,
      title: title || undefined,
      comment: comment || undefined,
      ...subRatings,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'Rate ' + booking.provider.name}
      description="Only customers whose job was actually completed can leave a review."
    >
      <form onSubmit={onSubmit} className="space-y-5">
        {error && <Alert variant="error">{error}</Alert>}

        <div className="text-center">
          <StarRating value={rating} onChange={setRating} size="lg" className="justify-center" />
          <p className="mt-1.5 h-5 text-base font-medium text-ink-700">{LABELS[rating]}</p>
        </div>

        <div className="space-y-2.5 panel-tint p-3">
          {SUB_RATINGS.map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3">
              <span className="text-base text-ink-600">{item.label}</span>
              <StarRating
                name={item.key}
                size="sm"
                value={subRatings[item.key] || 0}
                onChange={(v) => setSubRatings({ ...subRatings, [item.key]: v })}
              />
            </div>
          ))}
        </div>

        <Input
          label="Headline"
          placeholder="Fixed it quickly and cleaned up"
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <Textarea
          label="Your review"
          rows={4}
          maxLength={2000}
          placeholder="What went well, and what could have been better?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />

        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={onClose} className="flex-1">
            Not now
          </Button>
          <Button type="submit" loading={submit.isPending} disabled={!rating} className="flex-1">
            Publish review
          </Button>
        </div>
      </form>
    </Modal>
  );
}
