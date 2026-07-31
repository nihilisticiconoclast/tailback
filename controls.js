/**
 * Builds the control rail from the parameter spec and reports changes.
 */

import { PARAMS } from './model.js';

export function buildControls(container, params, onChange) {
  const readouts = new Map();

  for (const spec of PARAMS) {
    const row = document.createElement('div');
    row.className = 'control';

    const head = document.createElement('div');
    head.className = 'control__head';

    const label = document.createElement('label');
    label.className = 'control__label';
    label.textContent = spec.label;
    label.htmlFor = `ctl-${spec.key}`;

    const value = document.createElement('output');
    value.className = 'control__value';
    value.htmlFor = `ctl-${spec.key}`;
    value.textContent = spec.format(params[spec.key]) + (spec.unit ? `\u2009${spec.unit}` : '');

    head.append(label, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.id = `ctl-${spec.key}`;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(params[spec.key]);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      params[spec.key] = next;
      value.textContent = spec.format(next) + (spec.unit ? `\u2009${spec.unit}` : '');
      onChange(spec.key, next);
    });

    const note = document.createElement('p');
    note.className = 'control__note';
    note.textContent = spec.note;

    row.append(head, input, note);
    container.append(row);
    readouts.set(spec.key, { input, value, spec });
  }

  return {
    sync(next) {
      for (const [key, { input, value, spec }] of readouts) {
        input.value = String(next[key]);
        value.textContent = spec.format(next[key]) + (spec.unit ? `\u2009${spec.unit}` : '');
      }
    },
  };
}
