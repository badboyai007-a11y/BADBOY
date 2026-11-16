import React, { useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, Ellipse, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { useOwnerAuth } from '@/context/OwnerAuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function DarkAiEmblem() {
  return <Svg viewBox="0 0 360 300" width="100%" height="100%">
    <Defs>
      <SvgGradient id="hood" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#253047"/><Stop offset=".45" stopColor="#080B16"/><Stop offset="1" stopColor="#300A32"/></SvgGradient>
      <SvgGradient id="purple" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#A000FF"/><Stop offset="1" stopColor="#3911FF"/></SvgGradient>
      <SvgGradient id="red" x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor="#FF3B70"/><Stop offset="1" stopColor="#FF1717"/></SvgGradient>
    </Defs>
    <Circle cx="180" cy="147" r="128" fill="none" stroke="#7100FF" strokeWidth="2" opacity=".35"/>
    <Circle cx="180" cy="147" r="115" fill="none" stroke="#F01869" strokeWidth="2" opacity=".3" strokeDasharray="5 8"/>
    <Path d="M18 70 L72 70 L92 48 M342 70 L288 70 L268 48 M20 220 L72 220 L91 242 M340 220 L288 220 L269 242" stroke="#6A20FF" strokeWidth="2" opacity=".7" fill="none"/>
    <Path d="M38 95 L63 95 L78 80 M322 95 L297 95 L282 80" stroke="#FF244F" strokeWidth="2" opacity=".65" fill="none"/>
    <Path d="M104 96 Q180 22 256 96 L278 228 Q246 276 180 282 Q114 276 82 228 Z" fill="url(#hood)" stroke="#6221A7" strokeWidth="3"/>
    <Path d="M108 116 Q180 35 252 116 L231 192 Q180 228 129 192 Z" fill="#03050B" stroke="#2D2452" strokeWidth="2"/>
    <Path d="M128 158 Q148 135 169 158 L151 168 Z" fill="url(#red)"/>
    <Path d="M192 158 Q213 135 232 158 L209 168 Z" fill="url(#red)"/>
    <Path d="M132 160 L164 155 M196 155 L228 160" stroke="#FF2349" strokeWidth="5" strokeLinecap="round"/>
    <Path d="M180 167 L165 210 L180 221 L195 210 Z" fill="#090D18" stroke="#8B1D7A" strokeWidth="2"/>
    <Path d="M120 60 L135 23 L153 46 L180 7 L207 46 L225 23 L240 60 Z" fill="#11121D" stroke="#D29B42" strokeWidth="3"/>
    <Path d="M135 42 L151 49 L180 18 L209 49 L225 42" stroke="#FFD16D" strokeWidth="3" fill="none"/>
    <Circle cx="180" cy="29" r="6" fill="#FF334D"/>
    <Path d="M91 184 Q51 162 39 193 Q24 224 65 241 L120 230 M269 184 Q309 162 321 193 Q336 224 295 241 L240 230" fill="#080B15" stroke="#4823A0" strokeWidth="5"/>
    <Path d="M48 200 L77 190 L92 205 L77 220 L48 214 Z M312 200 L283 190 L268 205 L283 220 L312 214 Z" fill="#141B2B" stroke="#7B31FF" strokeWidth="2"/>
    <Circle cx="70" cy="205" r="5" fill="#B400FF"/><Circle cx="290" cy="205" r="5" fill="#FF254A"/>
    <Path d="M180 229 Q139 251 116 282 L244 282 Q221 251 180 229Z" fill="#080A13" stroke="#A21BFF" strokeWidth="2"/>
  </Svg>;
}

export default function OwnerLoginScreen() {
  const { signIn } = useOwnerAuth();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (busy || !token.trim()) return;
    setBusy(true); setError(null);
    try { await signIn(token.trim()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Owner Login করা যায়নি। আবার চেষ্টা করুন।'); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient colors={['#03040A','#0A0617','#100510']} style={StyleSheet.absoluteFill}/>
      <View pointerEvents="none" style={styles.ambientPurple}/>
      <View pointerEvents="none" style={styles.ambientRed}/>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content,{paddingTop:Math.max(insets.top,12)+8,paddingBottom:Math.max(insets.bottom,16)+14,minHeight:height}]}>
          <View style={styles.topLine}><Text style={styles.kicker}>THINK BEYOND</Text><Text style={styles.kickerRed}>LIMITS.</Text><View style={styles.live}><View style={styles.liveDot}/><Text style={styles.liveText}>SECURE SYSTEM</Text></View></View>
          <View style={[styles.hero,{height:Math.min(270,Math.max(180,height*.28))}]}><DarkAiEmblem/></View>
          <View style={styles.brandWrap}>
            <Text style={styles.brand}>BADBOY <Text style={styles.brandRed}>AI</Text></Text>
            <Text style={styles.tagline}>SMART  •  SECURE  •  POWERFUL</Text>
          </View>
          <LinearGradient colors={['#9A16FF','#2D7BFF','#FF234E']} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.frame}>
            <View style={styles.panel}>
              <View style={styles.shield}><Feather name="lock" size={22} color="#FFFFFF"/></View>
              <Text style={styles.loginTitle}>OWNER <Text style={styles.loginRed}>LOGIN</Text></Text>
              <Text style={styles.subtitle}>Enter your Owner Token to access</Text>
              <Text style={styles.subtitle}>Badboy AI features</Text>
              <View style={styles.inputWrap}>
                <Feather name="key" size={19} color="#C7B9FF"/>
                <TextInput value={token} onChangeText={setToken} placeholder="Owner Token" placeholderTextColor="#77748A" autoCapitalize="none" autoCorrect={false} secureTextEntry={!showToken} textContentType="password" style={styles.input} editable={!busy} onSubmitEditing={()=>void handleSignIn()} returnKeyType="go"/>
                <Pressable onPress={()=>setShowToken(v=>!v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={showToken?'Hide token':'Show token'}><Feather name={showToken?'eye-off':'eye'} size={19} color="#C7B9FF"/></Pressable>
              </View>
              {error?<View style={styles.errorBox}><Feather name="alert-triangle" color="#FF536B" size={16}/><Text style={styles.errorText}>{error}</Text></View>:null}
              <Pressable onPress={()=>void handleSignIn()} disabled={busy||!token.trim()} style={({pressed})=>[styles.button,pressed&&{opacity:.82},(busy||!token.trim())&&{opacity:.55}]}>
                <LinearGradient colors={['#9B18FF','#5B32F5','#EF174C']} start={{x:0,y:0}} end={{x:1,y:0}} style={styles.buttonGradient}>
                  {busy?<ActivityIndicator color="#FFFFFF"/>:<><Feather name="log-in" size={19} color="#FFFFFF"/><Text style={styles.buttonText}>LOGIN NOW</Text></>}
                </LinearGradient>
              </Pressable>
              <View style={styles.warning}><Feather name="alert-triangle" size={22} color="#FF344F"/><View style={{flex:1}}><Text style={styles.warningTitle}>OWNER AUTHORIZATION REQUIRED</Text><Text style={styles.warningText}>Without Owner Login, you cannot access the main app.</Text></View></View>
              <View style={styles.features}>
                <View style={styles.feature}><Feather name="shield" size={20} color="#18D9FF"/><Text style={styles.featureText}>SECURE</Text></View>
                <View style={styles.feature}><Feather name="award" size={20} color="#FFBF4A"/><Text style={styles.featureText}>OWNER</Text></View>
                <View style={styles.feature}><Feather name="zap" size={20} color="#24D7FF"/><Text style={styles.featureText}>FULL POWER</Text></View>
                <View style={styles.feature}><Feather name="star" size={20} color="#D34DFF"/><Text style={styles.featureText}>PREMIUM AI</Text></View>
              </View>
            </View>
          </LinearGradient>
          <Text style={styles.footer}>BADBOY AI v1.0.0  •  BUILT FOR THE REAL POWER USERS</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles=StyleSheet.create({
 screen:{flex:1,backgroundColor:'#03040A'},
 ambientPurple:{position:'absolute',top:30,left:-110,width:260,height:260,borderRadius:130,backgroundColor:'#6D00FF',opacity:.13},
 ambientRed:{position:'absolute',top:210,right:-130,width:260,height:260,borderRadius:130,backgroundColor:'#FF123F',opacity:.10},
 content:{paddingHorizontal:17,justifyContent:'center',gap:8},
 topLine:{flexDirection:'row',alignItems:'center',gap:6},
 kicker:{color:'#D9D9E8',fontSize:12,fontWeight:'900',letterSpacing:2},
 kickerRed:{color:'#FF3158',fontSize:12,fontWeight:'900',letterSpacing:2},
 live:{marginLeft:'auto',flexDirection:'row',alignItems:'center',gap:6,borderWidth:1,borderColor:'#48265D',borderRadius:20,paddingHorizontal:9,paddingVertical:5},
 liveDot:{width:6,height:6,borderRadius:3,backgroundColor:'#2BEEA5'},
 liveText:{color:'#B8AFCB',fontSize:8,fontWeight:'900',letterSpacing:1},
 hero:{height:220,width:'100%',alignSelf:'center'},
 brandWrap:{alignItems:'center',marginTop:-8,marginBottom:9},
 brand:{color:'#F6F4FF',fontSize:38,fontWeight:'900',fontStyle:'italic',letterSpacing:-1.5,textShadowColor:'#A100FF',textShadowRadius:15},
 brandRed:{color:'#FF284F'},
 tagline:{color:'#C6BDD9',fontSize:10,fontWeight:'900',letterSpacing:2,marginTop:1},
 frame:{borderRadius:23,padding:2,shadowColor:'#8D1AFF',shadowOpacity:.55,shadowRadius:18,elevation:12},
 panel:{backgroundColor:'rgba(5,6,15,0.97)',borderRadius:21,paddingHorizontal:15,paddingTop:15,paddingBottom:13,alignItems:'center',borderWidth:1,borderColor:'#33214E'},
 shield:{width:44,height:44,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:'#25143D',borderWidth:1,borderColor:'#8C36FF',marginBottom:6},
 loginTitle:{color:'#F6F3FF',fontSize:25,fontWeight:'900',fontStyle:'italic',letterSpacing:1},
 loginRed:{color:'#FF3156'},
 subtitle:{color:'#C0BCD0',fontSize:12,textAlign:'center',lineHeight:17},
 inputWrap:{width:'100%',height:53,marginTop:15,marginBottom:12,borderWidth:1,borderColor:'#6A2D91',borderRadius:13,backgroundColor:'#0C0C19',paddingHorizontal:13,flexDirection:'row',alignItems:'center',gap:10},
 input:{flex:1,color:'#FFFFFF',fontSize:14,paddingVertical:10},
 errorBox:{width:'100%',flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'#35101D',borderRadius:10,padding:10,marginBottom:10},
 errorText:{color:'#FF9BAA',fontSize:12,flex:1},
 button:{width:'100%',borderRadius:13,overflow:'hidden',marginBottom:13},
 buttonGradient:{height:52,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:10},
 buttonText:{color:'#FFFFFF',fontSize:15,fontWeight:'900',letterSpacing:1.5},
 warning:{width:'100%',flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:'#722039',borderRadius:12,padding:11,backgroundColor:'#160910',marginBottom:12},
 warningTitle:{color:'#FF536B',fontSize:9,fontWeight:'900',letterSpacing:.7,marginBottom:3},
 warningText:{color:'#D4C5CC',fontSize:11,lineHeight:15},
 features:{width:'100%',flexDirection:'row',justifyContent:'space-between',borderTopWidth:1,borderColor:'#292039',paddingTop:11},
 feature:{flex:1,alignItems:'center',gap:4,borderRightWidth:1,borderColor:'#30233E'},
 featureText:{color:'#CFC7DF',fontSize:8,fontWeight:'900',letterSpacing:.6},
 footer:{color:'#8F789E',fontSize:8,fontWeight:'800',letterSpacing:1,textAlign:'center',marginTop:7},
});
