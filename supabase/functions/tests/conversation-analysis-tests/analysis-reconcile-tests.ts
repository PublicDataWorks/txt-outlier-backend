import { describe, it } from 'jsr:@std/testing/bdd'
import { assertEquals } from 'jsr:@std/assert'

// No setup.ts import: the decision is pure, so the suite's Postgres bootstrap is not needed.
import {
  expectedTagAfterLabelChange,
  shouldRequeueForLabelChange,
} from '../../user-actions/handlers/analysis-reconcile.ts'

const completed = (over: Partial<{ tag: string | null; modelTag: string | null }> = {}) => ({
  status: 'completed',
  tag: 'reporter-engaged',
  modelTag: 'reporter-engaged',
  ...over,
})

describe('shouldRequeueForLabelChange', () => {
  // The case this exists for: 27% of impact labels land more than 72 hours after close, so the label
  // arrives long after the analysis finished and nothing would otherwise revisit it.
  it('requeues when a newly applied label disagrees with the stored tag', () => {
    assertEquals(shouldRequeueForLabelChange(completed(), { tag: 'info-gap' }), true)
  })

  it('does not requeue when the label agrees with the stored tag', () => {
    assertEquals(shouldRequeueForLabelChange(completed({ tag: 'info-gap' }), { tag: 'info-gap' }), false)
  })

  // A label REMOVAL is only detectable via model_tag. Without that fallback the stored tag would still
  // look correct - it is the tag the removed label put there - and the row would never be revisited.
  it('requeues when the label that drove the tag is removed', () => {
    const stored = completed({ tag: 'info-gap', modelTag: 'reporter-engaged' })
    assertEquals(shouldRequeueForLabelChange(stored, null), true)
    assertEquals(expectedTagAfterLabelChange(stored, null), 'reporter-engaged')
  })

  it('does not requeue when a removed label never changed the tag in the first place', () => {
    const stored = completed({ tag: 'info-gap', modelTag: 'info-gap' })
    assertEquals(shouldRequeueForLabelChange(stored, null), false)
  })

  it('requeues when one label is swapped for another', () => {
    const stored = completed({ tag: 'info-gap', modelTag: 'reporter-engaged' })
    assertEquals(shouldRequeueForLabelChange(stored, { tag: 'user-sat' }), true)
  })

  // Rows analyzed before model_tag existed have nothing to fall back to, so they must not be requeued on
  // a removal - there is no evidence the tag is now wrong, and requeueing every such row on any label
  // change would re-analyze the whole backfill.
  it('does not requeue a pre-model_tag row when no label applies', () => {
    const stored = completed({ tag: 'reporter-engaged', modelTag: null })
    assertEquals(shouldRequeueForLabelChange(stored, null), false)
  })

  it('still requeues a pre-model_tag row when a label positively disagrees', () => {
    const stored = completed({ tag: 'reporter-engaged', modelTag: null })
    assertEquals(shouldRequeueForLabelChange(stored, { tag: 'info-gap' }), true)
  })

  // A pending row will read the labels when it runs; a processing row holds a lease and resetting it
  // would fight the queue for ownership of work already in flight.
  it('never touches a row that is not completed', () => {
    for (const status of ['pending', 'processing', 'failed', 'skipped']) {
      assertEquals(
        shouldRequeueForLabelChange({ ...completed(), status }, { tag: 'info-gap' }),
        false,
        status,
      )
    }
  })
})
