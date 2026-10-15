import { describe, expect, it } from 'vitest';
import { excludeFlaggedRecords, hasFlaggedNote } from './filters';
import { makeSale } from '../test/fixtures';

/**
 * What the "YB111" rule actually matches.
 *
 * It is a case-insensitive substring test over the whole Invoice Notes field, not an exact match,
 * so a note that says YB111 and then goes on to say something else is still flagged. These are the
 * real notes from the clinic's export, kept verbatim: the question "does it catch YB111 with other
 * comments as well" is worth more than a restatement of the rule.
 */
const flagged = (invoiceNotes: string | null) => hasFlaggedNote(makeSale({ invoiceNotes }));

describe('hasFlaggedNote', () => {
  it('catches the bare code', () => {
    expect(flagged('YB111')).toBe(true);
  });

  it('catches the code followed by a full comment', () => {
    expect(flagged('YB111 UNDER MR YASSER FULL CHECK UP. FOR 2 PERSON WITH HIS WIFE. he will come at 11')).toBe(true);
  });

  it('catches the code buried mid-sentence', () => {
    expect(flagged('Please note YB111 applies to this invoice')).toBe(true);
    expect(flagged('full check up - yb111 - booked by reception')).toBe(true);
  });

  it('ignores case however it was typed', () => {
    for (const note of ['yb111', 'Yb111', 'yB111', 'YB111']) {
      expect(flagged(note)).toBe(true);
    }
  });

  it('catches the longer variants the clinic also uses', () => {
    expect(flagged('YB1111')).toBe(true);
    expect(flagged('YB11111 under mr yasser')).toBe(true);
  });

  it('leaves a note alone that never mentions the code', () => {
    // From the same export, immediately between two flagged rows.
    expect(flagged('to discuss her plan with dr enas and start the treatment')).toBe(false);
  });

  it('treats an empty or missing note as unflagged', () => {
    expect(flagged(null)).toBe(false);
    expect(flagged('')).toBe(false);
  });

  it('does not match a near miss', () => {
    // The rule is deliberately loose about what follows the code, but it is still looking for the
    // code: a different reference number must not quietly remove a line from revenue.
    expect(flagged('YB11')).toBe(false);
    expect(flagged('YB 111')).toBe(false);
    expect(flagged('YC111')).toBe(false);
  });
});

describe('excludeFlaggedRecords', () => {
  it('removes every row carrying the code, whatever else the note says', () => {
    const rows = [
      makeSale({ invoiceNotes: 'YB111', amount: 100 }),
      makeSale({ invoiceNotes: 'YB111 UNDER MR YASSER FULL CHECK UP. FOR 2 PERSON WITH HIS WIFE. he will come at 11', amount: 200 }),
      makeSale({ invoiceNotes: 'to discuss her plan with dr enas and start the treatment', amount: 400 }),
      makeSale({ invoiceNotes: null, amount: 800 }),
    ];
    const kept = excludeFlaggedRecords(rows);
    expect(kept.map((r) => r.amount)).toEqual([400, 800]);
  });
});
