# review67 最終カバレッジと固定原本

公式 `npm run test:coverage` の最終実行結果である。途中の別原本・別試験カウンタは合算していない。

証拠は `/tmp/yose-coverage-nprjDm`、標準報告は `coverage/`、実行ログは `/tmp/yose67-coverage-release.log` である。Node 1811/1811、Chromium UI 1206/1206が成功し、失敗・取消・skipは全て0である。全体Line 99.79% / Branch 97.94%であり、全54ファイルが各Line/Branch 97%以上である。

入力420ファイルは計測開始前と終了直後でSHA-256が一致した。入力manifestのSHA-256は `8925b0827fa2de0f03c9458f8e1135674fbb5b8d326f20f6da9ed8f117d91d36` である。終了後のレビュー結果追記は文書だけに限定し、本番原本・試験・計測scriptは変更しない。

|対象|Line %|Branch %|
|---|---:|---:|
|`gas/Code.gs`|99.77|97.16|
|`js/app.js`|100.00|100.00|
|`js/crypto.js`|100.00|100.00|
|`js/db.js`|100.00|100.00|
|`js/db/backup_merger.js`|100.00|97.59|
|`js/db/backup_replacement.js`|100.00|98.70|
|`js/db/defaults.js`|100.00|100.00|
|`js/db/storage_engine.js`|99.24|97.87|
|`js/db/yose_db.js`|99.83|97.80|
|`js/logic.js`|100.00|100.00|
|`js/logic/advance_links.js`|100.00|100.00|
|`js/logic/aggregator.js`|100.00|98.65|
|`js/logic/budget_engine.js`|100.00|97.70|
|`js/logic/bulk_edit.js`|100.00|100.00|
|`js/logic/category_trend.js`|100.00|97.50|
|`js/logic/chart_geometry.js`|100.00|100.00|
|`js/logic/data_insights.js`|100.00|100.00|
|`js/logic/data_integrity.js`|100.00|99.45|
|`js/logic/date_utils.js`|100.00|100.00|
|`js/logic/furusato_calculator.js`|100.00|97.05|
|`js/logic/investment.js`|100.00|100.00|
|`js/logic/master_maintenance.js`|100.00|97.43|
|`js/logic/master_sync.js`|100.00|99.27|
|`js/logic/sync_changes.js`|100.00|100.00|
|`js/logic/transaction_factory.js`|100.00|100.00|
|`js/sync.js`|100.00|97.22|
|`js/theme_bootstrap.js`|100.00|100.00|
|`js/ui/advance_link_controller.js`|100.00|98.70|
|`js/ui/auth_controller.js`|100.00|98.37|
|`js/ui/backup_import_controller.js`|100.00|98.78|
|`js/ui/budget_settings_controller.js`|100.00|97.27|
|`js/ui/bulk_edit_controller.js`|100.00|97.04|
|`js/ui/chart_controller.js`|100.00|97.33|
|`js/ui/chart_interaction.js`|100.00|97.43|
|`js/ui/chart_viewport.js`|100.00|97.18|
|`js/ui/coordinator.js`|99.56|97.00|
|`js/ui/form_busy.js`|100.00|100.00|
|`js/ui/furusato_controller.js`|100.00|97.98|
|`js/ui/insights_controller.js`|100.00|97.43|
|`js/ui/maintenance_controller.js`|99.22|97.00|
|`js/ui/master_conflict_controller.js`|100.00|98.36|
|`js/ui/master_controller.js`|100.00|97.23|
|`js/ui/render_session.js`|100.00|100.00|
|`js/ui/settings_controller.js`|98.03|97.23|
|`js/ui/summary_controller.js`|100.00|97.43|
|`js/ui/sync_result.js`|100.00|100.00|
|`js/ui/sync_status_controller.js`|100.00|97.87|
|`js/ui/tag_memo_input.js`|100.00|98.48|
|`js/ui/tx_edit_controller.js`|100.00|97.65|
|`js/ui/tx_input_controller.js`|99.79|97.22|
|`js/ui/tx_list_controller.js`|99.56|97.22|
|`js/version.js`|100.00|100.00|
|`js/webauthn.js`|100.00|100.00|
|`sw.js`|100.00|100.00|

## 計測した本番原本

|対象|SHA-256|
|---|---|
|`gas/Code.gs`|`8633cbcc27c5ee21e02ff9e633b6a711860ca3aa90b1ed8fbdf680b521ecdd87`|
|`js/app.js`|`872b8fa3ea133065ab80f3421cf65e9e7306431f28e74078811b1b560d5fe0cb`|
|`js/crypto.js`|`8e8d56c4a98f32aacb2e18a87d987d87c413a678b023e0be0a3146b5b4bfd89f`|
|`js/db.js`|`f66526481fdab02c55ebac6c58220d9867fc7c9a1a509eca83fcf7042be69061`|
|`js/db/backup_merger.js`|`2f34335f09cf5b3b05465e513303c7d48394d8cd5fab67a15eb2200c4c537e8b`|
|`js/db/backup_replacement.js`|`8fe822268ac9d19e65a5625e9ab1ec204fbdc8b7d0a7d95a6dcea09a2c9f9b71`|
|`js/db/defaults.js`|`2f52350658be3aa3cea697e957997381c6d4e0406f42e34e59637999ce593d76`|
|`js/db/storage_engine.js`|`b7c87b2e513124cb9156908d933c685e9dce62b35b80364623596b94dd43a09e`|
|`js/db/yose_db.js`|`e14434b358d6fc73e14d114606efbcd84d7ed51f8ff501d6dfb8a7d8bc0903b0`|
|`js/logic.js`|`cbe80f3b332d7cd0cc02630e045fe5b860cdec276c3fd4fcd6ff8ba937b72178`|
|`js/logic/advance_links.js`|`09528aa4080722b4a786a3c301503e9d5665ac76ead2d1f1dc939470ac39b45e`|
|`js/logic/aggregator.js`|`91a6d865bdf0aa5f547857dbfe96b7387ce6fe97da8366bc193b753a01cef51a`|
|`js/logic/budget_engine.js`|`396a8e83f4e97def599dfb4cbb93e5a59d9de3e85bb367eeb7d35d122de866c3`|
|`js/logic/bulk_edit.js`|`6ed89c5df79e3d82aa9a72ee8a91c592cbebea78e5f6fcdf8327b7a53ceb8b59`|
|`js/logic/category_trend.js`|`dad8822cb8958175f266887ae4045654aa977838ada4a8844fef1fa8bfc163c3`|
|`js/logic/chart_geometry.js`|`33d2001a8b401073251e472affe83e1273ae545ae581ec6eb8eaab786640f9e3`|
|`js/logic/data_insights.js`|`873a3201d85c68f31b0dcbe32cafe9161b2e3f485b84ffca182112a852a4b95b`|
|`js/logic/data_integrity.js`|`5d85b5f1b1617d4a391c19957c46a397e05f26bb3718e4a618709722b2690159`|
|`js/logic/date_utils.js`|`eefa97513fd2ab08316f12b16857bc5085f0084c0c7a05654368136a822423c1`|
|`js/logic/furusato_calculator.js`|`fb6e41523b206223e5ec7c44c92b7a424b9f5a6c359d834a5bdb77712d3e0206`|
|`js/logic/investment.js`|`11dd1ced57faeac57b3c5ec507ce04186557ee37752ef78fa52dbb3774b5ddd0`|
|`js/logic/master_maintenance.js`|`962a614d8f911ef0634b7e77eb428f223d08f1c0d1ec9704663e14ddd71986c2`|
|`js/logic/master_sync.js`|`764eae63657cac05f2cceab36d2320a759537c95291221d6e97436f3be50669f`|
|`js/logic/sync_changes.js`|`d09d9a4ec7e8035e650423fd8d69f77b6f20e10dddbb59c401868f2062e4e8fa`|
|`js/logic/transaction_factory.js`|`80cfb4d62f3e65da487ec77938d94aff319801c7a62e89dfe16d792831b84d2e`|
|`js/sync.js`|`8309389163a265f263715a1c9b3a106177d9decd2be483412eb20fdc7d27d834`|
|`js/theme_bootstrap.js`|`94d08b8db12bb4ad7791d001af634be3ad5326d3ba2b779d4f728ac9baa68541`|
|`js/ui/advance_link_controller.js`|`88dccfdef34b509c646faf8d61605e99c88dd1f7ac44e580be3df63cb012d090`|
|`js/ui/auth_controller.js`|`aad72593e2aabc95d7864239eec28cd4494ae3c34d4e1ca1175a004f4b7ced0d`|
|`js/ui/backup_import_controller.js`|`2a7a70638ce309f9e80e1b4d5c53ec98a20320a4394fb974d1f5818999ebdafd`|
|`js/ui/budget_settings_controller.js`|`30f354fd909cd62fa0295a7440df7aadb427417b8e734dc50a958b6a79f82a90`|
|`js/ui/bulk_edit_controller.js`|`80f460a6e69a34cea93588fb766054d53edbe6151d15870d8932cbba3bb7b8f8`|
|`js/ui/chart_controller.js`|`f40388318c7ba0f9bdf46c93ace8473373cd665744ca14dfcdc2c5498ad77052`|
|`js/ui/chart_interaction.js`|`81a770477023b1ddbaab922a0eec0e17dd46195b0d57119f7a1241d599c6134e`|
|`js/ui/chart_viewport.js`|`babb9c3e78ba63e8eff588e5cb0a6ce1ae580155cb78028a67fa1d553ae5107b`|
|`js/ui/coordinator.js`|`79b107cbaa2f72a826a0ebd83a8db8941f00995d99d88310aa00e70c5e2f7995`|
|`js/ui/form_busy.js`|`169c574ee25fe26fd59d97d1235fec30717fc1e9690ee5c084b7f35ae7eb7782`|
|`js/ui/furusato_controller.js`|`c080e38773bf4c93a519c0ae57f585848911fc561e77411486bd44a5e0911deb`|
|`js/ui/insights_controller.js`|`9a3aeb2e5665166ee472c6961e0cad70ce0d212e65901f2112a6a1529d0852c1`|
|`js/ui/maintenance_controller.js`|`f54f5b6afb4f1b9d381873a666d7d05b058ea821fdd2635bb42aa5c2d611ff3a`|
|`js/ui/master_conflict_controller.js`|`4f00a1e80e9905b8126e06016ef86afbd5881a6ece079e5053bc37ec1ef72b22`|
|`js/ui/master_controller.js`|`51511e24b36769ecb67b5ed48969523f01c6ce7b7fb820f4c1f0c2a61c453e08`|
|`js/ui/render_session.js`|`c45bfd9e6d65d2c75ce379ab5f07c9653d2b6f5f2e086996af27ecc2b241b825`|
|`js/ui/settings_controller.js`|`cdaa1e32d3e88393190c49b0a813cf5b4dced8050fd9685153db3f71c2427219`|
|`js/ui/summary_controller.js`|`739265385629fde3a394e585e939cf71133a2199888314d548c8ce39e220c9ad`|
|`js/ui/sync_result.js`|`fc1337085e7a7320bd8ca06f8479bdc4ac72a4050fb70c96efc53527135962bd`|
|`js/ui/sync_status_controller.js`|`d746e7d275f4e52fcd72984fb67ae7cd4c6b4d1c6e2bf9e95527718cfd76a90b`|
|`js/ui/tag_memo_input.js`|`3da6ecfa766ed0c5ab260c42d63c97e9e6d7d2b1b6d55d6ca50b2e1fa8e14e91`|
|`js/ui/tx_edit_controller.js`|`4bd1b38bc93fbd75c33893c1ded75a3efde3c417cf4084f6289d239cc338db20`|
|`js/ui/tx_input_controller.js`|`6a24bbb2b8f348c6e4c98173208d756ba4fbbf0b517c37ec38c41d96be80ea05`|
|`js/ui/tx_list_controller.js`|`6d60181add7c8fd38d3824c634f37e41bf2dc0856867381e7495baa437d63cd9`|
|`js/version.js`|`f2786b5f013b33f72d77786aab337c7dfbdace41ceedbe6f542541d94b8eed9f`|
|`js/webauthn.js`|`5e4cb92a4bd0e7987e6108bfbc83bef965f6dd36186b1bfa57790ccaa81934b2`|
|`sw.js`|`917811cfe4bd1ee11c3249f78b3f6a89956e7a31919be6e43844815ed1d60a4d`|
