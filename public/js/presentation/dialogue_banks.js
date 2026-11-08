// Dialogue banks for the rest of the roster.
//
// Original writing for this game only. Each fighter gets a distinct register - clipped, theatrical,
// formal, deadpan - so the intros do not all sound like the same narrator. Kept in its own module so
// the eight authored banks in dialogue.js stay readable and additions do not risk editing them.
export const EXTRA_LINES = Object.freeze({
  superman: {
    voice: { pitch: .78, rate: .94 },
    intro: ['I would rather end this without a fight.', 'But I will not let you hurt anyone else.'],
    win: ['It is over. Stay down.', 'Strength is for protecting people. Remember that.'],
    lose: ['I underestimated you. It will not happen twice.'],
    form: ['The sun gives me more than you know.'],
    ultimate: ['This ends now.'],
    ability: ['Hold still.']
  },
  iron_man_tony_stark: {
    voice: { pitch: .92, rate: 1.16 },
    intro: ['I built this suit in a cave. This will be easier.', 'Let us keep it short, I have a press conference.'],
    win: ['Genius, billionaire, victor. In that order.', 'I would apologise, but I am not sorry.'],
    lose: ['Okay. New plan. Better suit.'],
    form: ['Power at one hundred and ten percent.'],
    ultimate: ['Full power, all systems!'],
    ability: ['Repulsors hot.']
  },
  hulk_bruce_banner: {
    voice: { pitch: .58, rate: .84 },
    intro: ['You will not like me when I stop holding back.', 'I tried talking first. I always try talking first.'],
    win: ['Hulk smash. Hulk done.', 'The other guy sends his regards.'],
    lose: ['Banner is going to be upset about this.'],
    form: ['Anger is not the problem. It is the fuel.'],
    ultimate: ['HULK SMASH!'],
    ability: ['Brace yourself.']
  },
  wonder_woman: {
    voice: { pitch: .96, rate: 1.0 },
    intro: ['You have chosen the wrong opponent.', 'I have faced gods. You are not one.'],
    win: ['Honour is what you do when no one is watching.', 'Stand, and remember this lesson.'],
    lose: ['A worthy blow. I will answer it.'],
    form: ['The gods lend me their strength.'],
    ultimate: ['For Themyscira!'],
    ability: ['My shield is yours to break.']
  },
  professor_x_charles_xavier: {
    voice: { pitch: .8, rate: .9 },
    intro: ['I know what you are thinking. I am not impressed.', 'Violence is a failure of imagination.'],
    win: ['You are already standing down. You simply have not noticed.'],
    lose: ['A mind can be shielded. Mine was not enough.'],
    form: ['Every mind in this arena is open to me.'],
    ultimate: ['Let me show you what I see.'],
    ability: ['Your thoughts are loud.']
  },
  the_flash_barry_allen: {
    voice: { pitch: 1.02, rate: 1.24 },
    intro: ['I could have finished this before you blinked.', 'Let us make this quick. I mean that literally.'],
    win: ['Fastest man alive. Still true.', 'Sorry. I was already gone.'],
    lose: ['Too slow. Today, at least.'],
    form: ['The Speed Force is with me.'],
    ultimate: ['Everything, at once, everywhere!'],
    ability: ['Catch me.']
  },
  doctor_strange: {
    voice: { pitch: .86, rate: .98 },
    intro: ['I have seen how this ends.', 'There is only one future where you win. This is not it.'],
    win: ['I told you how this would go.', 'Time is a courtesy I extend to you.'],
    lose: ['I miscalculated. There are fourteen million ways to be wrong.'],
    form: ['The Eye of Agamotto is open.'],
    ultimate: ['Dormammu, I have come to bargain!'],
    ability: ['Step through.']
  },
  arnold_schwarzenegger: {
    voice: { pitch: .62, rate: .86 },
    intro: ['I am back.', 'You picked the wrong machine to fight.'],
    win: ['Hasta la vista.', 'Come with me if you want to keep your teeth.'],
    lose: ['I will be back.'],
    form: ['Time to terminate.'],
    ultimate: ['Maximum power!'],
    ability: ['Get to the chopper.']
  },
  goku: {
    voice: { pitch: 1.08, rate: 1.08 },
    intro: ['You look strong. Let us find out how strong.', 'I have been waiting for a fight like this.'],
    win: ['That was great. Let us do it again sometime.', 'You pushed me further than I expected.'],
    lose: ['I need to train harder. Thank you for showing me that.'],
    form: ['This is the power I have been chasing.'],
    ultimate: ['Everything I have got, all at once!'],
    ability: ['Ka-me-ha-me-ha!']
  },
  kaze: {
    voice: { pitch: 1.02, rate: 1.06 },
    intro: ['The wind already told me how this goes.', 'Move quickly, or not at all.'],
    win: ['You were standing still. That was the mistake.'],
    lose: ['The wind changed. Next time I will change with it.'],
    form: ['The air answers me now.'],
    ultimate: ['Let the storm take you!'],
    ability: ['Feel the pressure.']
  },
  vegeta: {
    voice: { pitch: .82, rate: .96 },
    intro: ['Do not waste my time, clown.', 'I am the prince of all Saiyans. Act accordingly.'],
    win: ['As expected. You were never in my league.', 'Do not mistake my mercy for weakness.'],
    lose: ['This is not over. It is a delay.'],
    form: ['Watch closely. This is real power.'],
    ultimate: ['Final Flash!'],
    ability: ['Begone.']
  },
  saitama: {
    voice: { pitch: .94, rate: .92 },
    intro: ['I was hoping for a real fight today.', 'Is there a sale on after this?'],
    win: ['That was fast. Too fast.', 'Okay.' ],
    lose: ['Huh. That has not happened before.'],
    form: ['I am not even trying yet.'],
    ultimate: ['Serious punch.'],
    ability: ['Normal punch.']
  },
  l_death_note_style: {
    voice: { pitch: .88, rate: 1.02 },
    intro: ['I have already worked out how you lose.', 'Sit down. This is a deduction, not a fight.'],
    win: ['Exactly as predicted. Every step.', 'You were the suspect from the beginning.'],
    lose: ['Interesting. I was wrong about one variable.'],
    form: ['Now the pieces are all in place.'],
    ultimate: ['Checkmate.'],
    ability: ['I know your name.']
  },
  all_might: {
    voice: { pitch: .84, rate: 1.04 },
    intro: ['Do not fear. I am here.', 'A hero always arrives when it matters.'],
    win: ['It is fine now. Why? Because I am here.', 'Go beyond. Plus Ultra.'],
    lose: ['I could not save this one. Not yet.'],
    form: ['My body may break, but the symbol does not.'],
    ultimate: ['United States of Smash!'],
    ability: ['One for All!']
  },
  levi_ackerman: {
    voice: { pitch: .76, rate: .96 },
    intro: ['Make this worth my time.', 'You are filthy. Stay still.'],
    win: ['Clean. Efficient.', 'That is what discipline looks like.'],
    lose: ['Tch. I got careless.'],
    form: ['This is what I was made for.'],
    ultimate: ['Everything at once.'],
    ability: ['Do not blink.']
  },
  mario: {
    voice: { pitch: 1.3, rate: 1.12 },
    intro: ['Wahoo! Let us-a go!', 'It is-a me! And it is-a your problem.'],
    win: ['Here we-a go!', 'That is-a one for the record books.'],
    lose: ['Mamma mia...'],
    form: ['Super star power!'],
    ultimate: ['Take-a this!'],
    ability: ['Let us-a jump!']
  },
  luigi: {
    voice: { pitch: 1.36, rate: 1.06 },
    intro: ['I am-a ready! Probably.', 'Please do not-a hurt me too much.'],
    win: ['I did it! I actually did it!', 'Luigi wins by a landslide!'],
    lose: ['Oh no...'],
    form: ['I feel-a brave now!'],
    ultimate: ['Here I-a go!'],
    ability: ['Watch out!']
  },
  link: {
    voice: { pitch: .95, rate: .94 },
    intro: ['Hyaa!', 'The sword does the talking.'],
    win: ['Hyaa.', 'The seal holds.'],
    lose: ['...'],
    form: ['The Triforce answers.'],
    ultimate: ['HAH!'],
    ability: ['Take this!']
  },
  master_chief: {
    voice: { pitch: .66, rate: .88 },
    intro: ['Target acquired.', 'Nothing personal, soldier.'],
    win: ['Mission complete.', 'Threat neutralised.'],
    lose: ['Requesting extraction.'],
    form: ['Armour at full charge.'],
    ultimate: ['Glass this sector.'],
    ability: ['Spartan charge.']
  },
  aang: {
    voice: { pitch: 1.12, rate: 1.04 },
    intro: ['I would rather talk this through.', 'I am not going to hurt you if I can help it.'],
    win: ['There is always another way.', 'Balance restored.'],
    lose: ['I still have a lot to learn.'],
    form: ['The Avatar State takes over.'],
    ultimate: ['All four elements, together!'],
    ability: ['Watch the air.']
  },
  madara_uchiha: {
    voice: { pitch: .7, rate: .9 },
    intro: ['Show me something worth my attention.', 'You stand before Uchiha Madara. Try to survive.'],
    win: ['Wake me when someone interesting arrives.', 'Pathetic.'],
    lose: ['Impressive. I will remember it.'],
    form: ['Behold true power.'],
    ultimate: ['This world is finished!'],
    ability: ['Burn.']
  },
  hashirama_senju: {
    voice: { pitch: .8, rate: .96 },
    intro: ['Let us settle this the honest way.', 'I would call you a friend, but you came to fight.'],
    win: ['That was a fine match. Truly.', 'Strength should build, not break.'],
    lose: ['You have surpassed me. Good.'],
    form: ['The forest answers my call.'],
    ultimate: ['Wood Style: True Thousand Hands!'],
    ability: ['Hold him.']
  },
  sasuke_uchiha: {
    voice: { pitch: .84, rate: .98 },
    intro: ['I have no interest in your reasons.', 'Stay out of my way.'],
    win: ['Do not follow me.', 'You were never the target.'],
    lose: ['Not enough. Not yet.'],
    form: ['The Sharingan sees everything.'],
    ultimate: ['Amaterasu!'],
    ability: ['Chidori!']
  },
  edna_mode: {
    voice: { pitch: .88, rate: 1.18 },
    intro: ['No capes. No excuses.', 'Darling, that suit is a crime.'],
    win: ['Fabulous. And functional.', 'You are welcome.'],
    lose: ['A design flaw. Mine, not yours.'],
    form: ['Now this is a silhouette.'],
    ultimate: ['And NO capes!'],
    ability: ['Watch the seams.']
  },
  spider_man: {
    voice: { pitch: 1.14, rate: 1.2 },
    intro: ['I am going to be honest, I did not plan for this.', 'Any chance we can talk about this first?'],
    win: ['Sorry! Genuinely sorry.', 'That went better than my usual Tuesday.'],
    lose: ['Ow. Ow. Learning experience.'],
    form: ['Okay, new plan.'],
    ultimate: ['Maximum spider!'],
    ability: ['Thwip!']
  },
  iron_spider: {
    voice: { pitch: 1.08, rate: 1.18 },
    intro: ['Instant kill mode is off. You are welcome.', 'I have got about forty ways out of this.'],
    win: ['Told you I had a plan.', 'Karen, log that as a win.'],
    lose: ['Karen, log that as a learning moment.'],
    form: ['Nanotech online.'],
    ultimate: ['Everything at once!'],
    ability: ['Web grenade!']
  }
});
