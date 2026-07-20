import { expect, it } from 'vitest'
import { SteeringQueue } from '@qiongqi/loop'

it('isolates steering text and cleanup by turn', () => {
  const queue = new SteeringQueue()
  queue.setTurn('turn-a')
  queue.enqueue('turn-a', 'continue A')
  queue.setTurn('turn-b')
  queue.enqueue('turn-b', 'continue B')

  expect(queue.peek('turn-a')).toEqual(['continue A'])
  expect(queue.peek('turn-b')).toEqual(['continue B'])
  queue.clear('turn-a')
  expect(queue.drain('turn-a')).toEqual([])
  expect(queue.drain('turn-b')).toEqual(['continue B'])
})
