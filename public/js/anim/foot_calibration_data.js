// Per-rig foot-contact calibration measured by scripts/probe-grounded-locomotion-roster.mjs.
//
// `FOOT_CONTACT_BY_IDENTITY` is the ankle height above the fighter origin at the lower edge of
// the rig's idle/walk contact band: the minimum of its idle band and the 10th percentile of its
// raw (un-IK'd) walk samples. It anchors the idle/stand/landing target.
//
// `FOOT_WALK_CONTACT_BY_IDENTITY` is the 10th percentile of the same raw walk/run samples on its
// own. An idle pose that stands lower than the walk clip (Hulk, Vegeta, Mario) must not drag the
// walk target below the clip's own foot floor: doing so makes the IK over-extend and slide the
// planted foot. The walk layer uses this value for walk/run/sprint clips and falls back to the
// idle value when a rig has no raw walk measurement.
//
// Regenerate with: node scripts/build-foot-calibration.mjs <sweep-report.json> [...]
export const FOOT_CONTACT_BY_IDENTITY = Object.freeze({
  aang: 0.1060,
  all_might: 0.1210,
  aquaman: 0.1836,
  arnold_schwarzenegger: 0.0934,
  captain_jack_sparrow: 0.1060,
  doctor_strange: 0.1085,
  doom_slayer: 0.1240,
  edna_mode: 0.0790,
  edward_elric: 0.0990,
  geralt_of_rivia: 0.1080,
  goku: 0.0571,
  green_lantern_hal_jordan: 0.1120,
  hashirama_senju: 0.1810,
  hulk_bruce_banner: 0.2160,
  infantry: 0.1486,
  iron_man_tony_stark: 0.1190,
  iron_spider: 0.1059,
  kaze: 0.1070,
  kratos: 0.1170,
  l_death_note_style: 0.1484,
  levi_ackerman: 0.0950,
  link: 0.1556,
  lord_voldemort: 0.1448,
  luigi: 0.1730,
  madara_uchiha: 0.1380,
  mario: 0.1400,
  master_chief: 0.1300,
  naruto_uzumaki: 0.0934,
  professor_x_charles_xavier: 0.0780,
  saitama: 0.0733,
  sasuke_uchiha: 0.1627,
  spider_man: 0.1010,
  superman: 0.1277,
  the_flash_barry_allen: 0.1380,
  thor: 0.1610,
  vegeta: 0.0883,
  wolverine_logan: 0.0900,
  wonder_woman: 0.1242,
});

export const FOOT_WALK_CONTACT_BY_IDENTITY = Object.freeze({
  aang: 0.1060,
  all_might: 0.1284,
  aquaman: 0.1836,
  arnold_schwarzenegger: 0.0934,
  captain_jack_sparrow: 0.1113,
  doctor_strange: 0.1087,
  doom_slayer: 0.1312,
  edna_mode: 0.0804,
  edward_elric: 0.1041,
  geralt_of_rivia: 0.1112,
  goku: 0.0575,
  green_lantern_hal_jordan: 0.1123,
  hashirama_senju: 0.2021,
  hulk_bruce_banner: 0.2782,
  infantry: 0.1488,
  iron_man_tony_stark: 0.1247,
  iron_spider: 0.0836,
  kaze: 0.1122,
  kratos: 0.1251,
  l_death_note_style: 0.1484,
  levi_ackerman: 0.1025,
  link: 0.1555,
  lord_voldemort: 0.1447,
  luigi: 0.1730,
  madara_uchiha: 0.1383,
  mario: 0.2181,
  master_chief: 0.1395,
  naruto_uzumaki: 0.0936,
  professor_x_charles_xavier: 0.0804,
  saitama: 0.0732,
  sasuke_uchiha: 0.1627,
  spider_man: 0.1014,
  superman: 0.1284,
  the_flash_barry_allen: 0.1378,
  thor: 0.1864,
  vegeta: 0.1274,
  wolverine_logan: 0.0933,
  wonder_woman: 0.1242,
});
