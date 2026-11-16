import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useOwnerAuth } from '@/context/OwnerAuthContext';

export default function OwnerLoginScreen() {
  const { signIn } = useOwnerAuth();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Owner Login করা যায়নি। আবার চেষ্টা করুন।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.glow} />
      <View style={styles.card}>
        <View style={styles.brandRow}>
          <View style={styles.logo}><Feather name="zap" size={23} color="#071426" /></View>
          <View><Text style={styles.brand}>BADBOY AI</Text><Text style={styles.brandSub}>PERSONAL AI WORKSPACE</Text></View>
        </View>
        <View style={styles.lockCircle}><Feather name="shield" size={25} color="#00D9FF" /></View>
        <Text style={styles.title}>Owner Login</Text>
        <Text style={styles.description}>তোমার ব্যক্তিগত Badboy workspace খুলতে Owner Token দিয়ে পরিচয় যাচাই করো। যাচাই সফল না হলে মূল Chat screen খুলবে না।</Text>
        <Text style={styles.label}>OWNER TOKEN</Text>
        <View style={styles.inputWrap}>
          <Feather name="key" size={17} color="#8FA6BD" />
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="Paste your Owner Token"
            placeholderTextColor="#718096"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showToken}
            textContentType="password"
            style={styles.input}
            editable={!busy}
            onSubmitEditing={() => void handleSignIn()}
            returnKeyType="go"
          />
          <Pressable accessibilityRole="button" accessibilityLabel={showToken ? 'Hide token' : 'Show token'} onPress={() => setShowToken(v => !v)} hitSlop={10}>
            <Feather name={showToken ? 'eye-off' : 'eye'} size={18} color="#8FA6BD" />
          </Pressable>
        </View>
        {error ? <View style={styles.errorBox}><Feather name="alert-circle" size={16} color="#FF8A8A" /><Text style={styles.error}>{error}</Text></View> : null}
        <Pressable onPress={() => void handleSignIn()} disabled={busy || !token.trim()} style={({ pressed }) => [styles.button, (busy || !token.trim()) && styles.buttonDisabled, pressed && styles.buttonPressed]}>
          {busy ? <ActivityIndicator color="#071426" /> : <><Feather name="lock" size={16} color="#071426" /><Text style={styles.buttonText}>Verify & Sign In</Text></>}
        </Pressable>
        <View style={styles.secureNote}><Feather name="shield-check" size={16} color="#35D49A" /><Text style={styles.note}>Token যাচাই হবে তোমার Badboy server-এ এবং Android SecureStore-এ সংরক্ষিত থাকবে। ভুল বা expired token হলে প্রবেশ বন্ধ থাকবে।</Text></View>
      </View>
      <Text style={styles.footer}>PRIVATE ACCESS · OWNER AUTHENTICATION REQUIRED</Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen:{flex:1,justifyContent:'center',padding:22,backgroundColor:'#071426',overflow:'hidden'},
  glow:{position:'absolute',width:300,height:300,borderRadius:150,backgroundColor:'#0B3A57',opacity:.35,top:-120,alignSelf:'center'},
  card:{width:'100%',maxWidth:440,alignSelf:'center',padding:23,borderRadius:25,backgroundColor:'#0A1E3A',borderWidth:1,borderColor:'#16456A'},
  brandRow:{flexDirection:'row',alignItems:'center',gap:12,marginBottom:30},
  logo:{width:43,height:43,borderRadius:14,backgroundColor:'#00D9FF',alignItems:'center',justifyContent:'center'},
  brand:{color:'#FFFFFF',fontSize:15,fontWeight:'900',letterSpacing:2},
  brandSub:{color:'#8FA6BD',fontSize:9,fontWeight:'700',letterSpacing:1.2,marginTop:3},
  lockCircle:{width:52,height:52,borderRadius:18,backgroundColor:'#103653',alignItems:'center',justifyContent:'center',marginBottom:15},
  title:{color:'#FFFFFF',fontSize:27,fontWeight:'900'},
  description:{color:'#B9C8D8',fontSize:13,lineHeight:21,marginTop:9,marginBottom:24},
  label:{color:'#8FA6BD',fontSize:10,fontWeight:'800',letterSpacing:1.3,marginBottom:8},
  inputWrap:{minHeight:54,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:'#285276',borderRadius:14,paddingHorizontal:14,backgroundColor:'#071426'},
  input:{flex:1,color:'#FFFFFF',fontSize:14,paddingVertical:13},
  errorBox:{flexDirection:'row',alignItems:'center',gap:8,marginTop:12,padding:10,borderRadius:10,backgroundColor:'#3A1D2A'},
  error:{color:'#FFAAAA',fontSize:12,flex:1},
  button:{minHeight:52,borderRadius:14,marginTop:18,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9,backgroundColor:'#00D9FF'},
  buttonDisabled:{opacity:.45},
  buttonPressed:{opacity:.8},
  buttonText:{color:'#071426',fontSize:14,fontWeight:'900'},
  secureNote:{flexDirection:'row',alignItems:'flex-start',gap:9,marginTop:20},
  note:{color:'#8FA6BD',fontSize:11,lineHeight:17,flex:1},
  footer:{color:'#58738F',fontSize:9,fontWeight:'800',letterSpacing:1.2,textAlign:'center',marginTop:20},
});
