require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'StackdRecordingService'
  s.version = package['version']
  s.summary = package['description']
  s.license = { :type => 'Proprietary', :text => 'Part of Stack\'d; not for redistribution.' }
  s.homepage = 'https://github.com/eugeniocalva/Stackd-Minimalist'
  s.author = 'Eugenio Calvaresi'
  s.source = { :git => 'https://github.com/eugeniocalva/Stackd-Minimalist.git', :tag => 'v' + package['version'] }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
end
