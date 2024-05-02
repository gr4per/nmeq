import React, { Component} from "react";
import {TextEntry, NumberInput, CheckBox} from "./StorageConnectionModal.js";

export default class SettingsDialog extends React.Component {  

  constructor(props) {
    super(props); // heading, info, gameState, playerName, choices array of key value pairs [{a:b},{c:d}], numChoices, allowCancel, noPrettyPrinting
    this.state = props.settings; // storageConnectionString, attenuationBands, bandConfig
    console.log("creating settings with choices " + JSON.stringify(this.state.visibleTS));
    this.state.maxAllowedBands = 5;
  }
  
  cancel() {
    this.props.callback(null);
  }
  
  commit(storageConnectionString) {
    if(storageConnectionString) {
      this.setState(ps => {
        ps.storageConnectionString = storageConnectionString;
        return ps;
      });
    }
    console.log("Committing new settings into deactivate modal: " + JSON.stringify(this.state));
    this.props.callback({...this.state,storageConnectionString:storageConnectionString?storageConnectionString:this.state.storageConnectionString});
  }
  
  updateAttenuationLimit(bandId, newValue) {
    console.log("called updateAttenuationLimit(" + bandId+ ", " + newValue + ")");
    this.setState(s=>{
      s.bandConfig[bandId]["limit5m"] = newValue;
      console.log("new bandConfig: " + JSON.stringify(s.bandConfig));
      return s;
    });
  }
  
  render() {
    console.log("render, settings = " + JSON.stringify(this.props.settings));
    console.log("this.props.settings.attenuationBands= " + this.props.settings.attenuationBands);
    return <div style={{textAlign:"center", backgroundColor:"white", borderRadius:"10px", padding:"20px", display:"flex", flexDirection:"column"}}>
      <div id="bandSelect" style={{display:"flex", flexDirection:"column"}}>
        <p style={{fontSize:"24px"}}>Configure Attenuation</p>
        {this.props.settings.attenuationBands.map( (c,i) => { 
          let bandLabel = c.substring(3,c.length).replace(/_/g,".");
          
          return <div key={"attenuationBandConfig_"+i} id={"attenuationBandConfig_"+i} style={{display:"flex", flexDirection:"row"}}>
          <div style={{width:"80px"}}>{bandLabel}</div><div style={{width:"80px"}}>1h limit</div><div style={{width:"80px"}}>{this.props.settings.thresholds[bandLabel.replace(/\./g,"_")]}</div>
          <div style={{width:"120px"}}>Algorithm limit</div><NumberInput onChange={this.updateAttenuationLimit.bind(this, bandLabel)} initialValue={this.state.bandConfig[bandLabel].limit5m}/>
        </div>
        })}
      </div>
      <div id="storageConfig">
        <TextEntry initialValue={this.props.settings.storageConnectionString} heading={"StorageConnectionString"} message={""} onSubmit={this.commit.bind(this)}/>
      </div>
    </div>;
  }
}