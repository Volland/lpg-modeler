---
tgs: "0.2"
schemas:
  Idea:
    id:
      - {kind: uuid7, property: uid}
      - {kind: luhmann, property: luhmann}
    template: "[[Templates/Idea]]"
    properties:
      status: {values: [open, settled], default: open}
  Log:
    id: {kind: timestamp, property: stamp, filename: true}
---
Ideas get a time-ordered `uid` and may take a Luhmann id; log notes are named by a timestamp.
