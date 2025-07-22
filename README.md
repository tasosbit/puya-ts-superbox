# puya-ts superbox: simple box list operations backed by multiple boxes

## Overview

Superbox enables performing simple list operations backed by multiple boxes.

Supported write ops:

- append value(s)
- delete value(s)

Read ops:

- Get value location (box, offset) by index 
- Get value data by index
- Get metadata, e.g. value count, byte length count, etc.

Restrictions:

- Fixed value sizes
- Not able to insert data at middle (see future work)

## Status

Draft / alpha

## Use case

The original use case for this is to facilitate very large VRF shuffles, where the options would not fit in a single box.

The superbox abstraction spreads option values over multiple boxes, making it easier to 1) compose the options list, and 2) retrieve the winner value by index.

A stretch goal was to facilitate a straightforward way to do multiple VRF draws without repeated winners, hence the delete operations.

## Configuration

Creating a "superbox" requires these values:

- name: Superbox name & boxes prefix
- maxBoxSize: Max individual box size
- valueSize: Value size
- valueSchema: String describing the value type, e.g. `uint32`
  - Meant for off-chain consumption

## Box naming convention

Boxes are currently named by convention:

Metadata boxes are suffixed with `_m`.

Data boxes are suffixed with an integer counter starting from `0`.

Example: A Superbox named `chunky` with two data boxes would have the following keys;

- chunky_m
- chunky0
- chunky1

## Metadata

Superbox metadata extends the configuration values specified above with some managed values:

```
/**
 * Metadata struct. Stored per superbox
 */
export class SuperboxMeta extends arc4.Struct<{
  /**
   * Size of individual boxes backing superbox
   */
  boxByteLengths: DynamicArray<UintN16>
  /**
   * Total data in superbox
   */
  totalByteLength: UintN64
  /**
   * Max individual box size to use
   */
  maxBoxSize: UintN64
  /**
   * Byte width of individual value. Used to enforce box/value boundaries & calculate offsets when fetching values by index
   */
  valueSize: UintN64
  /**
   * Informational. Schema of value, e.g. `(uint16,uint16)` for Tuple<uint16, uint16>
   */
  valueSchema: Str
}> {}
```

## Future work

For "full marks", this could be changed to allow arbitrary data writes at any point in the superbox.

To enable this we would change one core aspect and provide an optimisation:

### Insert anywhere at finite cost ~= arbitrary data box naming

1) To make it possible to operate over large superboxes, we want to avoid having to shift the box values "downstream" of our insertion point, as this would cost too many opcodes and would likely not be doable within a single group for large enough boxes. Superbox operations should be atomic and leave the data in a good state.

For this we want to be able to insert data boxes between existing ones, so we would keep the convention-based data box naming system for creating new boxes, but we would also store the data box names in their correct order. 

E.g. After inserting data after box zero, we could end up with data box names:

```
data0
data4
data1
data2
data3
```

The order of these boxes would be stored in Metadata

### Available space optimization

In order to facilitate efficient insertion at arbitrary locations, we could optimize our writing strategy to take two factors into account:

- maxBoxSize: would remain the hard limit of individual box size
- optimalBoxSize: would be the box size at which we stop appending

An example would be a maxBoxSize of 1024, with a smaller optinal size of ~80% / 820 bytes. When appending data, boxes would be kept to 820 bytes, with capacity to grow from arbitrary insertions up to 1024 before a new box is created.
