/*
* This class allows to derive required attenuation per band from current 
* equivalent SPL aggregates of bands to be attenuated.
* The idea is to call this in intervals on a live feed of SPL data
* For this purpose the updateAttenuation function can be called on every new record.
* However, its nature being asynchronous because of the required network comms with the 
* Sound hardware, it will ignore any concurrent calls to updateAttenuation until
* the last one succeeds.
* 
* interface: 
* remoteConfig.algorithm = attnNoop|attnSlopeBased
* remoteConfig.dsp206Config.ipAddress
* remoteConfig.dsp206Config.deviceID
* remoteConfig.bandConfig[bandId].limit5m
* remoteConfig.bandConfig[bandId].minIncDelay
* bands = array of bandIds
* measBuffer.buf[measBuffer.idx] = get most recent buffer line
*   time - used
*   respTime
*   leq_s   - associate array of 1s leq values per band
*   ee      - associative array of 1s energy equivalent values per band
*   leq_10s - associative array of 10s equivalent SPL values per band - used
*   leq_5m  - associative array of 5m  equivalent SPL values per band
*   leq_1h  - associative array of 1h  equivalent SPL values per band
*/
export default class Attenuation {
  /**
   * 
   * @param {*} bandConfig associative array from band center frequenzy in Hz or kHz and using dot (.) as decimal separator
   *                       allows only standard bands such as 6.3Hz, 8Hz, 10Hz, 12.5Hz, 16Hz, 20Hz, 25Hz, 31.5Hz, 40Hz,...
   *                       for each band following values are required:
   *   - limit5m decibel value that is used as limit for deriving attenuation
   *   - minIncDelay milliseconds for the attenuator to wait for a previous attenuation increase to take effect
   *   - minDecDelay milliseconds for the attenuator to wait after a previous attenuation lift to take effect
   * 
   * @param {*} deviceConfig object with fields (currently only dsp206 supported):
   *   - ipAddress ipv4 address of the sound hardware
   *   - deviceID bus ID of the sound hardware
   * 
   * @param {*} algorithmName selects used algorithm for the attenuator, currently attnNoop and attnSlopeBased supported
   *
   */
  constructor(bandConfig, deviceConfig, algorithmName, getGeqSetting, setGeqLevel) {
    this.algorithms = {"noop":this.attnNoop, "slope":this.attnSlopeBased};
    this.algorithmName = (algorithmName != null && Object.keys(this.algorithms).indexOf(algorithmName) > -1)?algorithmName:"attnNoop";
    console.log("set algorithm to " + this.algorithm);
    this.dsp206Config = deviceConfig; // ipAddress, deviceID
    this.bandConfig = bandConfig; // associative array of bandId -> {limit5m, minIncDelay}
    this.bands = Object.keys(bandConfig);
    this.updAttn = false;
    this.attnInfo = {};
    this.setGeqLevel = setGeqLevel?setGeqLevel:null;
    this.getGeqSetting = getGeqSetting?getGeqSetting:null;
    for(let i = 0; i < this.bands.length;i++) {
      this.attnInfo[this.bands[i]] = {lastUpdate:null,level:0.0,v5m:null,v1h:null};
    }
 
    this.dsp206 = null;
    //if(!this.setGeqLevel)this.initDevice();
  }
  
  updateBandConfig(newBc) {
    console.log("oldBC: " + JSON.stringify(this.bandConfig));
    console.log("newBc: " + JSON.stringify(newBc));
    for(let bk of Object.keys(this.bandConfig)) {
      if(newBc[bk]) {
        this.bandConfig[bk] = newBc[bk];
      }
    }
  }
  /*initDevice() {
    if(this.dsp206) {
      if(this.dsp206.deviceID != this.dsp206Config.deviceID || this.dsp206.ipAddress != this.dsp206Config.ipAddress) {
        console.log("config for dsp206 changed, tearing down instance...");
        try {
          this.dsp206.close();
          this.dsp206 = new Dsp206(this.dsp206Config.deviceID, this.dsp206Config.ipAddress);
          console.log("recreated dsp206 instance with new config");
        }
        catch(e) {
          console.error("error closing dsp206: ", e);
        }
      }
    }
    else {
      this.dsp206 = new Dsp206(this.dsp206Config.deviceID, this.dsp206Config.ipAddress);
      console.log("created new dsp206 instance");
    }
  }*/


  /**
   * Slope based approach: check slope of leq_5m value since last attn update
   * if slope is rising and over limit, increase attenuation
   * if slope is rising towards limit, ease it off by pulling down the respective EQ band some more
   * if slope is decreasing towards limit from above, decide whether it is quick enough to still meet the limit on 1h average
   * if slope is decreasing and 5m lower than limit, ease off attenuation
   * 
   * recentBufferValues expects to find members
   *   time - ISOString representation of date when the samples were taken/calulated
   *   leq_10s - associative array of bandId -> equivalent SPL for the last 10s for this band
   * as associative arrays with an element per each bandId configured
   */
  async updateAttenuation(recentBufferValues) {
    let algorithm = this.algorithms[this.algorithmName].bind(this);
    if(!algorithm) {
        algorithm = this.attnNoop;
    }
    console.log("calling algorithm by name " + this.algorithmName);
    algorithm(recentBufferValues);
  }

  async attnNoop() {
    return;
  }

  bandNameToFrequency(bandName) {
    let s = bandName;
    if(bandName.startsWith("Leq"))s = s.substring(3,s.length);
    s=s.replace(/Hz/g,"");
    let kilo = false;
    if(s.indexOf("k")>-1) {
      s = s.replace(/k/g,"");
      kilo = true;
    }
    s = s.replace(/_/g,".");
    console.log("s = " + s);
    let f = parseFloat(s);
    if(kilo) f = f*1000;
    return f;
  }

  async attnSlopeBased(base) {
    if(this.updAttn) { 
      console.log("update attn in progress, skipping");
    } // prevent multiple entry
    console.log("update attn based on " + JSON.stringify(base));
    this.updAttn = true;
    let geqSetting = null;
    if(this.getGeqSetting) {
      //console.log("calling injected method to query geq setting");
      try {
        geqSetting = await this.getGeqSetting(0);
      }
      catch(e) {
        console.error("attenuationSlopeBased, couldnt get geq setting: ", e);
        this.updAttn = false;
        throw e;
      }
    }
    else {
      try {
          geqSetting = await this.dsp206.getGeqConfig(0); // InA, returns array of {bandId, frequency, level} structs
          //console.log("received current InA GEQ: " + JSON.stringify(geqSetting));
      }
      catch(e) {
          console.error("Error getting geq config: ", e);
          this.updAttn = false;
          return;
      }
    }
    base.time = new Date(base.time);
    //console.log("update attn on record " + JSON.stringify(base)+ ", base.time = " + (typeof base.time) + ", top entry time: " + measBuffer.buf[measBuffer.idx].time);
    for(let band of Object.keys(this.bandConfig)) {
      let bandId = "Leq"+band.replace(/\./g,"_");
      let bandConfig = this.bandConfig[band];
      console.log("updating attn for band " + band + " using bandId " + bandId);
      // is the 5m value over the limit
      let ai = this.attnInfo[band];
      let frequency = this.bandNameToFrequency(bandId);
      console.log("geqSetting =  " + typeof geqSetting);
      console.log("frequency =  " +frequency);
      let geqBand = geqSetting.find((g) => {
        return (g.frequency == frequency);
      });
      let aiCurrentLevel = geqBand?geqBand.level:0;
      //console.log("aiCurrent level band = " + band + " is " + aiCurrentLevel + ", geqSetting = " + JSON.stringify(geqSetting));
      if(ai.lastUpdate) {
        if(new Date().getTime() - ai.lastUpdate.getTime() < Math.min(bandConfig.minIncDelay, bandConfig.minDecDelay)) {
          continue; // do nothing yet, wait for delay to elapse
        }
      }
      let oldLevel = ai.level;
      //let current5mlevel = base["leq_5m"][band];
      let current10slevel = base["leq_10s"][bandId];
      //let current1hlevel = base["leq_1h"][band];
      let slope = ai.lastUpdate?(current10slevel - oldLevel)/(base.time.getTime()-ai.lastUpdate.getTime()):0;
      let slopeFactor = 0.1;
      let maxAllowedSlope = (bandConfig.limit5m - current10slevel)*slopeFactor;
      // this means we limit the scope so that level cannot cut limit within next 10 secs
      console.log("5m limit = " + bandConfig.limit5m + ", current10slevel = " + current10slevel);
      /*if(bandConfig.limit1h < current1hlevel) {
      let mas1h = 0;
      maxAllowedSlope = Math.min(maxAllowedSlope, mas1h);
      console.log("limiting maxAllowedSlope of " + band + " by 1h limit");
      }*/
      console.log("slope " + band + " = " + slope + ", maxAllowedSlope = " + maxAllowedSlope + ", slope over time " + (ai.lastUpdate?base.time.getTime()-ai.lastUpdate.getTime():"no") + " ms");
      
      if(slope > maxAllowedSlope) { // we are already over limit in 5m
        // has it been attenuated before?
        //console.log("band " + band + " over limit: " + base["leq_5m"][lbl] + ", limit = " + bandConfig.limit5m);
        if(ai.lastUpdate && new Date().getTime() - ai.lastUpdate.getTime() < bandConfig.minIncDelay) {
          continue; // do nothing yet, wait for delay to elapse
        }
        if(oldLevel != aiCurrentLevel) {
          // skip update since we haven't seen effect of last update yet
          console.log("current geq level " + aiCurrentLevel + " of band " + band + " not set to target " + oldLevel + " yet, no further adjustment for now.");
        }
        else {
          // increase attenuation
          let attnDelta = 0.5; // 1 dB steps, regardless of slope
          if(current10slevel - bandConfig.limit5m > 2) {
            attnDelta = 1;
            console.log("setting attn delta to " + attnDelta + " due to 2 db excess peak");
          }
          else if(current10slevel - bandConfig.limit5m > 4) {
            attnDelta = 3;
            console.log("setting attn delta to " + attnDelta + " due to 4 db excess peak");
          }
          ai.level = oldLevel - attnDelta;
          if(ai.level < -12)ai.level = -12;
          //ai.v5m = current5mlevel;
          ai.v10s = current10slevel;
          ai.lastUpdate = new Date();
        }
      }
      else { // slope is ok
        if(ai.lastUpdate && (new Date().getTime()-ai.lastUpdate.getTime()) > bandConfig.minDecDelay && ai.level < 0) {
          let attnDelta=0.5;
          ai.level = oldLevel + attnDelta;
          if(ai.level > 0)ai.level = 0;
          //ai.v5m = current5mlevel;
          ai.v10s = current10slevel;
          ai.lastUpdate = new Date();
          console.log("reducing attn on band " + band + ": " + ai.level);
        }
      }
      if(aiCurrentLevel != ai.level) {
        console.log("attn of " + band + " is " + aiCurrentLevel + ", not matching current target " + ai.level);
        await this.updateEQ(band, ai.level);
      }
    } // end for-loop over all bands
    this.updAttn = false;
  }

  // need to be careful not queue too many updates here
  async updateEQ(band, level) {
    if(["A","B","C","D"].indexOf(band) > -1){
      console.log("ignoring updateEQ for band " + band + " because it isn't available in GEQ");
      return;
    }
    let frequency = parseFloat(band.replace(/Hz/g, "").replace(/k/g,"000"));
    if(this.setGeqLevel){
      let channelIdx = 0;
      console.log("setting geq via injected callback: channel " + channelIdx + ", frequency = " + frequency + ", level = " + level);
      await this.setGeqLevel(0, frequency, level);
    }
    else if(dsp206) {
      try {
        await dsp206.setGeqLevel(0, frequency, level);
        console.log("updated geq of InA on band " + frequency + " to " + level + " dB");
      }
      catch(e) {
        console.log("GEQ update failed trying to set level " + level + " on band " + frequency + " Hz");
      }
    }
    else {
      console.log("no dsp206, skipping attenuation change");
    }
  }
}

//exports.Attenuation = Attenuation;