mdlr('[test]enge:mmu', m => {

  const { expect, it } = m.test;

  const mmu = m.require('enge:mmu');

  it('mmu is an object', done => {
    expect(typeof mmu).to.eql('object');
    done();
  });

})