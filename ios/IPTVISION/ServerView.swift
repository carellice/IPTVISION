import SwiftUI

/// Collegamento al server di casa (IPTVISION su CasaOS).
struct ServerView: View {
    @EnvironmentObject var model: AppModel
    @Environment(\.dismiss) var dismiss

    @State var address = ""
    @State var user = ""
    @State var pass = ""
    @State var register = false
    @State var invite = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Collega l'app a IPTVISION sul tuo server CasaOS: canali, film e serie passeranno da lì, e preferiti e Continua a guardare saranno gli stessi su ogni dispositivo.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Section {
                    TextField("http://192.168.1.10:8765", text: $address)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: {
                    Text("Indirizzo del server")
                } footer: {
                    Text("Dentro casa basta l'indirizzo IP del server con la porta (http://…). Fuori casa usa l'indirizzo Tailscale (https://…ts.net). Lo trovi anche in IPTVISION nel browser, in Impostazioni → Server di casa.")
                }
                Section {
                    Picker("Account", selection: $register) {
                        Text("Ho già un account").tag(false)
                        Text("Creane uno").tag(true)
                    }
                    .pickerStyle(.segmented)
                    TextField("Nome utente", text: $user).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $pass)
                    if register {
                        TextField("Codice invito (se il server lo chiede)", text: $invite).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                }
                if let e = model.serverError {
                    Section { Text(e).foregroundStyle(.red) }
                }
                Section {
                    Button {
                        Task {
                            if await model.connectServer(address: address, user: user, pass: pass, register: register, invite: invite) { dismiss() }
                        }
                    } label: {
                        HStack {
                            Spacer()
                            if model.serverBusy {
                                ProgressView()
                                Text("Collegamento in corso…")
                            } else { Text("Collega il server").bold() }
                            Spacer()
                        }
                    }
                    .disabled(model.serverBusy || address.isEmpty || user.isEmpty || pass.isEmpty)
                }
            }
            .navigationTitle("Server di casa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Annulla") { dismiss() } } }
            .onAppear { model.serverError = nil }
        }
    }
}

/// Sezione delle impostazioni: stato del server di casa, sincronizzazione, collega e scollega.
struct ServerSettingsSection: View {
    @EnvironmentObject var model: AppModel
    @State var connecting = false

    var body: some View {
        Section {
            if let url = model.homeServer {
                LabeledContent("Indirizzo", value: url)
                LabeledContent("Account", value: model.account?.username ?? "")
                if let n = model.serverNetwork { LabeledContent("Rete del server", value: n) }
                if let at = model.serverSyncedAt {
                    LabeledContent("Sincronizzato", value: at.formatted(date: .omitted, time: .shortened))
                }
                if let e = model.serverError { Text(e).font(.caption).foregroundStyle(.red) }
                Button { Task { await model.syncServer(force: true) } } label: { Label("Sincronizza ora", systemImage: "arrow.triangle.2.circlepath") }
                Button { connecting = true } label: { Label("Collega un altro server", systemImage: "server.rack") }
                Button(role: .destructive) { model.disconnectServer() } label: { Label("Scollega il server", systemImage: "xmark.circle") }
            } else {
                Button { connecting = true } label: { Label("Collega il server", systemImage: "server.rack") }
            }
        } header: {
            Text("Server di casa")
        } footer: {
            Text(model.homeServer == nil
                 ? "Con IPTVISION installato su CasaOS, l'account IPTV resta sul server e preferiti e Continua a guardare sono uguali su ogni dispositivo."
                 : "Scollegando, l'app torna a usare l'account IPTV di prima direttamente dal provider. Preferiti e posizioni restano.")
        }
        .sheet(isPresented: $connecting) { ServerView().environmentObject(model) }
    }
}
