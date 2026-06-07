export type ConferenceFixture = {
  sourceUrl: string;
  title: string;
  dates: string;
  host: string;
  lastOpenedAt: number;
  days: ConferenceDayFixture[];
};

export type ConferenceDayFixture = {
  label: string;
  sessions: SessionFixture[];
};

export type SessionFixture = {
  title: string;
  room: string;
  startsAt: string;
  endsAt: string;
  talks: TalkFixture[];
};

export type TalkFixture = {
  contributionId: string;
  title: string;
  speaker: string;
  startsAt: string;
  endsAt: string;
  room: string;
  bookmarked?: boolean;
  materials: MaterialFixture[];
};

export type MaterialFixture =
  | {
      kind: 'pdf';
      sourceUrl: string;
      displayName: string;
      pageCount: number;
      selected?: boolean;
      annotatedSlides?: number[];
    }
  | {
      kind: 'non-pdf';
      sourceUrl: string;
      displayName: string;
      mimeType: string;
    };

export const conferenceFixtures = {
  small: {
    sourceUrl: 'https://small.indico.example.org/event/indicoink-small-2026',
    title: 'IndicoInk Small Event 2026',
    dates: 'June 12, 2026',
    host: 'small.indico.example.org',
    lastOpenedAt: 1_749_721_200_000,
    days: [
      {
        label: 'Friday, June 12, 2026',
        sessions: [
          {
            title: 'Opening keynote',
            room: 'Auditorium A',
            startsAt: '09:00',
            endsAt: '10:30',
            talks: [
              {
                contributionId: 'small-1001',
                title: 'Designing a calm note-taking workflow',
                speaker: 'Ada Lovelace',
                startsAt: '09:00',
                endsAt: '09:45',
                room: 'Auditorium A',
                bookmarked: true,
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://small.indico.example.org/event/indicoink-small-2026/materials/small-1001-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 10,
                    selected: true,
                    annotatedSlides: [2, 3, 4],
                  },
                ],
              },
              {
                contributionId: 'small-1002',
                title: 'Tracking talks across a conference',
                speaker: 'Grace Hopper',
                startsAt: '09:45',
                endsAt: '10:30',
                room: 'Auditorium A',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://small.indico.example.org/event/indicoink-small-2026/materials/small-1002-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 8,
                    selected: true,
                    annotatedSlides: [],
                  },
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://small.indico.example.org/event/indicoink-small-2026/materials/small-1002-supplement.pdf',
                    displayName: 'Supplementary deck',
                    pageCount: 3,
                    annotatedSlides: [1],
                  },
                ],
              },
            ],
          },
          {
            title: 'Workflow clinic',
            room: 'Room 204',
            startsAt: '11:00',
            endsAt: '12:00',
            talks: [
              {
                contributionId: 'small-2001',
                title: 'When slides are not available',
                speaker: 'Katherine Johnson',
                startsAt: '11:00',
                endsAt: '11:30',
                room: 'Room 204',
                materials: [
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://small.indico.example.org/event/indicoink-small-2026/materials/small-2001-recording.mp4',
                    displayName: 'Recording',
                    mimeType: 'video/mp4',
                  },
                ],
              },
              {
                contributionId: 'small-2002',
                title: 'Live annotation patterns',
                speaker: 'Dorothy Vaughan',
                startsAt: '11:30',
                endsAt: '12:00',
                room: 'Room 204',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://small.indico.example.org/event/indicoink-small-2026/materials/small-2002-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 6,
                    selected: true,
                    annotatedSlides: [5, 6],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } satisfies ConferenceFixture,
  large: {
    sourceUrl: 'https://symposium.indico.example.org/event/indicoink-2026',
    title: 'IndicoInk Grand Symposium 2026',
    dates: 'July 21-23, 2026',
    host: 'symposium.indico.example.org',
    lastOpenedAt: 1_749_979_800_000,
    days: [
      {
        label: 'Tuesday, July 21, 2026',
        sessions: [
          {
            title: 'Opening plenary',
            room: 'Main Hall',
            startsAt: '09:00',
            endsAt: '10:15',
            talks: [
              {
                contributionId: 'large-1001',
                title: 'Conference notes in the flow of the talk',
                speaker: 'Margaret Hamilton',
                startsAt: '09:00',
                endsAt: '09:35',
                room: 'Main Hall',
                bookmarked: true,
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1001-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 12,
                    selected: true,
                    annotatedSlides: [1, 3, 7],
                  },
                ],
              },
              {
                contributionId: 'large-1002',
                title: 'Large conference data without noise',
                speaker: 'Barbara Liskov',
                startsAt: '09:35',
                endsAt: '10:15',
                room: 'Main Hall',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1002-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 9,
                    selected: true,
                    annotatedSlides: [4],
                  },
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1002-extras.pdf',
                    displayName: 'Extra figures',
                    pageCount: 4,
                    annotatedSlides: [],
                  },
                ],
              },
            ],
          },
          {
            title: 'Parallel session A',
            room: 'Room 1',
            startsAt: '10:30',
            endsAt: '12:00',
            talks: [
              {
                contributionId: 'large-1101',
                title: 'Session positioning for dense agendas',
                speaker: 'Edsger Dijkstra',
                startsAt: '10:30',
                endsAt: '11:00',
                room: 'Room 1',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1101-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 7,
                    selected: true,
                    annotatedSlides: [2],
                  },
                ],
              },
              {
                contributionId: 'large-1102',
                title: 'Touched-first controls for live sessions',
                speaker: 'Adele Goldberg',
                startsAt: '11:00',
                endsAt: '11:30',
                room: 'Room 1',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1102-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 5,
                    selected: true,
                    annotatedSlides: [1, 5],
                  },
                ],
              },
              {
                contributionId: 'large-1103',
                title: 'Non-PDF materials in talk details',
                speaker: 'Donald Knuth',
                startsAt: '11:30',
                endsAt: '12:00',
                room: 'Room 1',
                materials: [
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1103-demo.zip',
                    displayName: 'Demo assets',
                    mimeType: 'application/zip',
                  },
                ],
              },
            ],
          },
          {
            title: 'Parallel session B',
            room: 'Room 2',
            startsAt: '10:30',
            endsAt: '12:00',
            talks: [
              {
                contributionId: 'large-1201',
                title: 'Annotation persistence at scale',
                speaker: 'Leslie Lamport',
                startsAt: '10:30',
                endsAt: '11:00',
                room: 'Room 2',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1201-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 11,
                    selected: true,
                    annotatedSlides: [6, 11],
                  },
                ],
              },
              {
                contributionId: 'large-1202',
                title: 'Agenda search across titles and speakers',
                speaker: 'Frances Allen',
                startsAt: '11:00',
                endsAt: '11:30',
                room: 'Room 2',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1202-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 6,
                    selected: true,
                    annotatedSlides: [],
                  },
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1202-handout.pdf',
                    displayName: 'Handout',
                    pageCount: 2,
                    annotatedSlides: [2],
                  },
                ],
              },
              {
                contributionId: 'large-1203',
                title: 'Exporting notes cleanly',
                speaker: 'Tim Berners-Lee',
                startsAt: '11:30',
                endsAt: '12:00',
                room: 'Room 2',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1203-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 8,
                    selected: true,
                    annotatedSlides: [3, 4],
                  },
                ],
              },
            ],
          },
          {
            title: 'Lunch and poster previews',
            room: 'Hallway',
            startsAt: '12:15',
            endsAt: '13:30',
            talks: [
              {
                contributionId: 'large-1301',
                title: 'Poster table overview',
                speaker: 'Alice Turing',
                startsAt: '12:15',
                endsAt: '12:45',
                room: 'Hallway',
                materials: [
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1301-poster.jpg',
                    displayName: 'Poster image',
                    mimeType: 'image/jpeg',
                  },
                ],
              },
              {
                contributionId: 'large-1302',
                title: 'Lunch notes and quick bookmarks',
                speaker: 'John Backus',
                startsAt: '12:45',
                endsAt: '13:30',
                room: 'Hallway',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-1302-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 4,
                    selected: true,
                    annotatedSlides: [1, 2, 4],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        label: 'Wednesday, July 22, 2026',
        sessions: [
          {
            title: 'Parallel session C',
            room: 'Room 3',
            startsAt: '09:00',
            endsAt: '10:30',
            talks: [
              {
                contributionId: 'large-2001',
                title: 'Shared session blocks and room changes',
                speaker: 'Radia Perlman',
                startsAt: '09:00',
                endsAt: '09:30',
                room: 'Room 3',
                bookmarked: true,
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2001-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 10,
                    selected: true,
                    annotatedSlides: [2, 8],
                  },
                ],
              },
              {
                contributionId: 'large-2002',
                title: 'Touch and pen workflows at a podium',
                speaker: 'Barbara Simons',
                startsAt: '09:30',
                endsAt: '10:00',
                room: 'Room 3',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2002-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 6,
                    selected: true,
                    annotatedSlides: [6],
                  },
                ],
              },
              {
                contributionId: 'large-2003',
                title: 'Conference library design choices',
                speaker: 'Bjarne Stroustrup',
                startsAt: '10:00',
                endsAt: '10:30',
                room: 'Room 3',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2003-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 9,
                    selected: true,
                    annotatedSlides: [],
                  },
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2003-notes.txt',
                    displayName: 'Speaker notes',
                    mimeType: 'text/plain',
                  },
                ],
              },
            ],
          },
          {
            title: 'Parallel session D',
            room: 'Room 4',
            startsAt: '10:45',
            endsAt: '12:15',
            talks: [
              {
                contributionId: 'large-2101',
                title: 'Stable identifiers for conference content',
                speaker: 'Evelyn Boyd Granville',
                startsAt: '10:45',
                endsAt: '11:15',
                room: 'Room 4',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2101-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 7,
                    selected: true,
                    annotatedSlides: [1],
                  },
                ],
              },
              {
                contributionId: 'large-2102',
                title: 'Offline cache and restart behavior',
                speaker: 'Margaret Burnett',
                startsAt: '11:15',
                endsAt: '11:45',
                room: 'Room 4',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2102-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 5,
                    selected: true,
                    annotatedSlides: [2, 5],
                  },
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2102-summary.pdf',
                    displayName: 'Summary',
                    pageCount: 2,
                    annotatedSlides: [],
                  },
                ],
              },
              {
                contributionId: 'large-2103',
                title: 'Accessibility cues in dense agendas',
                speaker: 'Sophie Wilson',
                startsAt: '11:45',
                endsAt: '12:15',
                room: 'Room 4',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2103-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 6,
                    selected: true,
                    annotatedSlides: [3],
                  },
                ],
              },
            ],
          },
          {
            title: 'Shared lunch forum',
            room: 'Main Hall',
            startsAt: '12:30',
            endsAt: '13:30',
            talks: [
              {
                contributionId: 'large-2201',
                title: 'Questions from the morning sessions',
                speaker: 'Alan Kay',
                startsAt: '12:30',
                endsAt: '13:00',
                room: 'Main Hall',
                materials: [
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2201-audio.wav',
                    displayName: 'Audio clip',
                    mimeType: 'audio/wav',
                  },
                ],
              },
              {
                contributionId: 'large-2202',
                title: 'Annotation review and export examples',
                speaker: 'Jean Sammet',
                startsAt: '13:00',
                endsAt: '13:30',
                room: 'Main Hall',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-2202-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 10,
                    selected: true,
                    annotatedSlides: [2, 5, 9],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        label: 'Thursday, July 23, 2026',
        sessions: [
          {
            title: 'Parallel session E',
            room: 'Room 5',
            startsAt: '09:00',
            endsAt: '10:15',
            talks: [
              {
                contributionId: 'large-3001',
                title: 'Conference library deletion and rollback',
                speaker: 'Susan Care',
                startsAt: '09:00',
                endsAt: '09:30',
                room: 'Room 5',
                bookmarked: true,
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3001-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 8,
                    selected: true,
                    annotatedSlides: [1, 8],
                  },
                ],
              },
              {
                contributionId: 'large-3002',
                title: 'One command to import a local fixture',
                speaker: 'Dennis Ritchie',
                startsAt: '09:30',
                endsAt: '10:00',
                room: 'Room 5',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3002-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 6,
                    selected: true,
                    annotatedSlides: [2],
                  },
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3002-supplement.pdf',
                    displayName: 'Supplement',
                    pageCount: 3,
                    annotatedSlides: [],
                  },
                ],
              },
              {
                contributionId: 'large-3003',
                title: 'Event summary and cache state',
                speaker: 'Mary Shaw',
                startsAt: '10:00',
                endsAt: '10:15',
                room: 'Room 5',
                materials: [
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3003-summary.html',
                    displayName: 'Session summary',
                    mimeType: 'text/html',
                  },
                ],
              },
            ],
          },
          {
            title: 'Closing plenary',
            room: 'Main Hall',
            startsAt: '10:30',
            endsAt: '12:00',
            talks: [
              {
                contributionId: 'large-3101',
                title: 'What the library should show first',
                speaker: 'John McCarthy',
                startsAt: '10:30',
                endsAt: '11:00',
                room: 'Main Hall',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3101-slides.pdf',
                    displayName: 'Slides',
                    pageCount: 9,
                    selected: true,
                    annotatedSlides: [4, 9],
                  },
                ],
              },
              {
                contributionId: 'large-3102',
                title: 'Annotated slides and their counts',
                speaker: 'Barbara Liskov',
                startsAt: '11:00',
                endsAt: '11:30',
                room: 'Main Hall',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3102-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 7,
                    selected: true,
                    annotatedSlides: [2, 6],
                  },
                ],
              },
              {
                contributionId: 'large-3103',
                title: 'Opening the right deck from a chooser',
                speaker: 'Judy Clapp',
                startsAt: '11:30',
                endsAt: '12:00',
                room: 'Main Hall',
                materials: [
                  {
                    kind: 'pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3103-main.pdf',
                    displayName: 'Main deck',
                    pageCount: 6,
                    selected: true,
                    annotatedSlides: [],
                  },
                  {
                    kind: 'non-pdf',
                    sourceUrl:
                      'https://symposium.indico.example.org/event/indicoink-2026/materials/large-3103-slides.json',
                    displayName: 'Metadata export',
                    mimeType: 'application/json',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } satisfies ConferenceFixture,
} as const;

export type ConferenceFixtureKey = keyof typeof conferenceFixtures;

const validateTime = (value: string, label: string) => {
  if (!/^\d{2}:\d{2}$/.test(value)) {
    throw new Error(`${label} must be an HH:MM time value.`);
  }

  const [hoursText, minutesText] = value.split(':');
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (hours > 23 || minutes > 59) {
    throw new Error(`${label} must be a valid 24-hour time.`);
  }
};

export const validateConferenceFixture = (fixture: ConferenceFixture) => {
  if (!fixture.sourceUrl.startsWith('https://')) {
    throw new Error(`Conference URL must be HTTPS: ${fixture.sourceUrl}`);
  }

  if (!fixture.title.trim()) {
    throw new Error('Conference title is required.');
  }

  if (!fixture.days.length) {
    throw new Error(`Conference ${fixture.title} must include at least one day.`);
  }

  const contributionIds = new Set<string>();
  let annotatedSlideCount = 0;
  let pdfMaterialCount = 0;
  let nonPdfMaterialCount = 0;

  for (const day of fixture.days) {
    if (!day.label.trim()) {
      throw new Error(`Conference ${fixture.title} has a day without a label.`);
    }

    if (!day.sessions.length) {
      throw new Error(`Day ${day.label} must include at least one session.`);
    }

    for (const session of day.sessions) {
      validateTime(session.startsAt, `Session ${session.title} start time`);
      validateTime(session.endsAt, `Session ${session.title} end time`);

      if (!session.title.trim()) {
        throw new Error(`Session on ${day.label} must have a title.`);
      }

      if (!session.room.trim()) {
        throw new Error(`Session ${session.title} must have a room.`);
      }

      if (!session.talks.length) {
        throw new Error(`Session ${session.title} must include at least one talk.`);
      }

      for (const talk of session.talks) {
        validateTime(talk.startsAt, `Talk ${talk.title} start time`);
        validateTime(talk.endsAt, `Talk ${talk.title} end time`);

        if (contributionIds.has(talk.contributionId)) {
          throw new Error(
            `Duplicate contribution ID found in fixture ${fixture.title}: ${talk.contributionId}`,
          );
        }

        contributionIds.add(talk.contributionId);

        if (!talk.title.trim()) {
          throw new Error(`Talk ${talk.contributionId} must have a title.`);
        }

        if (!talk.speaker.trim()) {
          throw new Error(`Talk ${talk.contributionId} must have a speaker.`);
        }

        if (!talk.room.trim()) {
          throw new Error(`Talk ${talk.contributionId} must have a room.`);
        }

        const pdfMaterials = talk.materials.filter(
          (material): material is Extract<MaterialFixture, { kind: 'pdf' }> =>
            material.kind === 'pdf',
        );
        const selectedMaterials = pdfMaterials.filter((material) => material.selected);
        if (selectedMaterials.length > 1) {
          throw new Error(
            `Talk ${talk.contributionId} must not mark more than one PDF as selected.`,
          );
        }

        for (const material of talk.materials) {
          if (material.kind === 'pdf') {
            pdfMaterialCount += 1;

            if (material.pageCount < 1) {
              throw new Error(
                `Talk ${talk.contributionId} has a PDF material with no pages.`,
              );
            }

            const annotatedSlides = material.annotatedSlides ?? [];
            const uniqueSlides = new Set(annotatedSlides);
            if (uniqueSlides.size !== annotatedSlides.length) {
              throw new Error(
                `Talk ${talk.contributionId} has duplicate annotated slide numbers.`,
              );
            }

            for (const slideNumber of annotatedSlides) {
              if (
                !Number.isInteger(slideNumber) ||
                slideNumber < 1 ||
                slideNumber > material.pageCount
              ) {
                throw new Error(
                  `Talk ${talk.contributionId} has an annotated slide outside its deck page count.`,
                );
              }
            }

            annotatedSlideCount += annotatedSlides.length;
            continue;
          }

          nonPdfMaterialCount += 1;
          if (!material.mimeType.trim()) {
            throw new Error(
              `Talk ${talk.contributionId} has a non-PDF material without a MIME type.`,
            );
          }
        }
      }
    }
  }

  return {
    dayCount: fixture.days.length,
    contributionCount: contributionIds.size,
    pdfMaterialCount,
    nonPdfMaterialCount,
    annotatedSlideCount,
  };
};

export const validateConferenceFixtures = (
  fixtures: ReadonlyArray<ConferenceFixture>,
) => fixtures.map((fixture) => validateConferenceFixture(fixture));

export const countConferenceSessions = (fixture: ConferenceFixture) =>
  fixture.days.reduce((total, day) => total + day.sessions.length, 0);

export const countConferenceTalks = (fixture: ConferenceFixture) =>
  fixture.days.reduce(
    (total, day) =>
      total + day.sessions.reduce((sessionTotal, session) => sessionTotal + session.talks.length, 0),
    0,
  );
