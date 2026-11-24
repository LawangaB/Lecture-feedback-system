import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardTitle } from '@/components/ui/card';
import { Table } from '@/components/ui/misc';

describe('shared UI accessibility', () => {
  it('exposes card title content as a heading and leaves table scrolling to native controls', () => {
    render(<><CardTitle>Attendance</CardTitle><Table><tbody><tr><td>Student</td></tr></tbody></Table></>);
    expect(screen.getByRole('heading', { name: 'Attendance' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Scrollable table' })).not.toHaveAttribute('tabindex');
  });
});
